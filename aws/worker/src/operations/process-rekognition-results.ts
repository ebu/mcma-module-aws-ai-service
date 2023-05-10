import { GetCelebrityRecognitionCommand, GetCelebrityRecognitionRequest,
    GetContentModerationCommand, GetContentModerationRequest, GetFaceDetectionCommand, GetFaceDetectionRequest,
    GetLabelDetectionCommand, GetLabelDetectionRequest, GetSegmentDetectionCommand, GetSegmentDetectionRequest, GetTextDetectionCommand, GetTextDetectionRequest } from "@aws-sdk/client-rekognition";
import { JobStatus, McmaException, ProblemDetail } from "@mcma/core";
import { getTableName } from "@mcma/data";
import { ProcessJobAssignmentHelper, ProviderCollection, WorkerRequest } from "@mcma/worker";
import { S3Locator } from "@mcma/aws-s3";
import { generateFilePrefix, writeOutputFile } from "./utils";
import { WorkerContext } from "../index";

export async function processRekognitionResult(providers: ProviderCollection, workerRequest: WorkerRequest, ctx: WorkerContext) {
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

        // 2. Retrieve job inputParameters
        const rekoJobId = workerRequest.input.jobInfo.rekoJobId;
        const rekoJobType = workerRequest.input.jobInfo.rekoJobType;
        const status = workerRequest.input.jobInfo.status;

        if (status !== "SUCCEEDED") {
            throw new McmaException("AI Rekognition failed: rekognition status:" + status);
        }

        // 3. Get the result from the Rekognition service
        const inputFile = jobAssignmentHelper.jobInput.inputFile as S3Locator;

        const prefix = generateFilePrefix(inputFile.url);
        let index = 1;

        const outputFiles: S3Locator[] = [];

        switch (rekoJobType) {
            case "StartCelebrityRecognition":
                const celebrityRecognitionParams: GetCelebrityRecognitionRequest = {
                    JobId: rekoJobId,
                    SortBy: "TIMESTAMP",
                };

                do {
                    const response = await ctx.rekognitionClient.send(new GetCelebrityRecognitionCommand(celebrityRecognitionParams));
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3Client));
                    celebrityRecognitionParams.NextToken = response.NextToken;
                } while (celebrityRecognitionParams.NextToken);
                break;
            case "StartFaceDetection":
                const faceDetectionParams: GetFaceDetectionRequest = {
                    JobId: rekoJobId,
                };

                do {
                    const response = await ctx.rekognitionClient.send(new GetFaceDetectionCommand(faceDetectionParams));
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3Client));
                    faceDetectionParams.NextToken = response.NextToken;
                } while (faceDetectionParams.NextToken);
                break;
            case "StartLabelDetection":
                const labelDetectionParams: GetLabelDetectionRequest = {
                    JobId: rekoJobId,
                    SortBy: "TIMESTAMP",
                };

                do {
                    const response = await ctx.rekognitionClient.send(new GetLabelDetectionCommand(labelDetectionParams));
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3Client));
                    labelDetectionParams.NextToken = response.NextToken;
                } while (labelDetectionParams.NextToken);
                break;
            case "StartTextDetection":
                const textDetectionParams: GetTextDetectionRequest = {
                    JobId: rekoJobId,
                };

                do {
                    const response = await ctx.rekognitionClient.send(new GetTextDetectionCommand(textDetectionParams));
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3Client));
                    textDetectionParams.NextToken = response.NextToken;
                } while (textDetectionParams.NextToken);
                break;
            case "StartContentModeration":
                const contentModerationParams: GetContentModerationRequest = {
                    JobId: rekoJobId,
                    SortBy: "TIMESTAMP",
                };

                do {
                    const response = await ctx.rekognitionClient.send(new GetContentModerationCommand(contentModerationParams));
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3Client));
                    contentModerationParams.NextToken = response.NextToken;
                } while (contentModerationParams.NextToken);
                break;
            case "StartSegmentDetection":
                const segmentDetectionParams: GetSegmentDetectionRequest = {
                    JobId: rekoJobId,
                };

                do {
                    const response = await ctx.rekognitionClient.send(new GetSegmentDetectionCommand(segmentDetectionParams));
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3Client));
                    segmentDetectionParams.NextToken = response.NextToken;
                } while (segmentDetectionParams.NextToken);
                break;
            default:
                throw new McmaException(`Rekognition job type '${rekoJobType} not implemented`);
        }

        jobAssignmentHelper.jobOutput.outputFiles = outputFiles;

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

