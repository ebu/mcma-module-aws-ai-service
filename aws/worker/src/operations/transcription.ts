import { ProcessJobAssignmentHelper, ProviderCollection, WorkerRequest } from "@mcma/worker";
import { AIJob, ConfigVariables, JobStatus, McmaException, ProblemDetail } from "@mcma/core";
import { buildS3Url, S3Locator } from "@mcma/aws-s3";
import { WorkerContext } from "../index";
import { generateFilePrefix, getFileExtension, uploadUrlToS3 } from "./utils";
import { StartTranscriptionJobRequest } from "aws-sdk/clients/transcribeservice";
import { getTableName } from "@mcma/data";

const configVariables = ConfigVariables.getInstance();

export async function transcription(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<AIJob>, ctx: WorkerContext) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    const inputFile = jobInput.get<S3Locator>("inputFile");
    const jobGuid = jobAssignmentHelper.jobAssignmentDatabaseId.substring(jobAssignmentHelper.jobAssignmentDatabaseId.lastIndexOf("/") + 1);

    const acceptedFileExtensions = ["mp3", "mp4", "wav", "flac", "ogg", "amr", "webm"];

    const fileExtension = getFileExtension(inputFile.url, false).toLowerCase();
    if (!acceptedFileExtensions.includes(fileExtension)) {
        throw new McmaException("Unacceptable input media format");
    }

    const outputBucket = configVariables.get("OutputBucket");
    const tempKey = generateFilePrefix(inputFile.url) + getFileExtension(inputFile.url);

    logger.info(`Copying media file to bucket '${outputBucket}' with key '${tempKey}`);
    await uploadUrlToS3(tempKey, inputFile.url, ctx.s3);

    logger.info("Building s3 url");
    const mediaFileUrl = await buildS3Url(outputBucket, tempKey, ctx.s3);

    logger.info("Starting transcription");

    const prefix = configVariables.get("Prefix");

    const params: StartTranscriptionJobRequest = {
        TranscriptionJobName: `${prefix}-${jobGuid}`,
        LanguageCode: "en-US",
        Media: {
            MediaFileUri: mediaFileUrl
        },
        MediaFormat: fileExtension,
        Subtitles: {
            Formats: ["vtt", "srt"],
        }
    };

    const data = await ctx.transcribeService.startTranscriptionJob(params).promise();
    logger.debug(data);
}

export async function processTranscribeResult(providers: ProviderCollection, workerRequest: WorkerRequest, ctx: WorkerContext) {
    const jobAssignmentHelper = new ProcessJobAssignmentHelper(
        await providers.dbTableProvider.get(getTableName()),
        providers.resourceManagerProvider.get(),
        workerRequest
    );

    const logger = jobAssignmentHelper.logger;

    const table = await providers.dbTableProvider.get(getTableName());
    const mutex = table.createMutex({
        name: jobAssignmentHelper.jobAssignmentDatabaseId,
        holder: ctx.awsRequestId,
        logger: logger,
    });

    await mutex.lock();
    try {
        await jobAssignmentHelper.initialize();

        if (jobAssignmentHelper.jobAssignment.status === JobStatus.Completed ||
            jobAssignmentHelper.jobAssignment.status === JobStatus.Failed ||
            jobAssignmentHelper.jobAssignment.status === JobStatus.Canceled) {
            logger.warn(`Job Assignment is already in final state '${jobAssignmentHelper.jobAssignment.status}'`);
            return;
        }

        const jobName = workerRequest.input.jobInfo.TranscriptionJobName;
        const jobStatus = workerRequest.input.jobInfo.TranscriptionJobStatus;

        const transcriptionJob = await ctx.transcribeService.getTranscriptionJob({ TranscriptionJobName: jobName }).promise();
        logger.info(transcriptionJob);

        if (jobStatus === "FAILED") {
            await jobAssignmentHelper.fail({
                type: "uri://mcma.ebu.ch/rfc7807/aws-ai-service/transcription-failure",
                title: "Failed to complete transcription",
                detail: transcriptionJob.TranscriptionJob?.FailureReason
            });
            return;
        }

        const outputFiles: S3Locator[] = [];

        const inputFile = jobAssignmentHelper.jobInput.get<S3Locator>("inputFile");
        const prefix = generateFilePrefix(inputFile.url);

        const transcriptUrl = transcriptionJob.TranscriptionJob?.Transcript?.TranscriptFileUri;
        const subtitleUrls = transcriptionJob.TranscriptionJob?.Subtitles?.SubtitleFileUris;

        if (transcriptUrl) {
            outputFiles.push(await uploadUrlToS3(prefix + getFileExtension(transcriptUrl), transcriptUrl, ctx.s3));
        }

        if (Array.isArray(subtitleUrls)) {
            for (const subtitleUrl of subtitleUrls) {
                outputFiles.push(await uploadUrlToS3(prefix + getFileExtension(subtitleUrl), subtitleUrl, ctx.s3));
            }
        }

        jobAssignmentHelper.jobOutput.set("outputFiles", outputFiles);

        logger.info("Marking JobAssignment as completed");
        await jobAssignmentHelper.complete();
    } catch (error) {
        logger.error(error);
        try {
            await jobAssignmentHelper.fail(new ProblemDetail({
                type: "uri://mcma.ebu.ch/rfc7807/aws-ai-service/generic-failure",
                title: "Generic failure",
                detail: error.message
            }));
        } catch (error) {
            logger.error(error);
        }
    } finally {
        await mutex.unlock();
    }
}
