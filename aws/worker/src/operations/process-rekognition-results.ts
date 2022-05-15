import { JobStatus, McmaException, ProblemDetail } from "@mcma/core";
import { getTableName } from "@mcma/data";
import { ProcessJobAssignmentHelper, ProviderCollection, WorkerRequest } from "@mcma/worker";
import { S3Locator } from "@mcma/aws-s3";
import { Rekognition } from "aws-sdk";
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
        const inputFile = jobAssignmentHelper.jobInput.get<S3Locator>("inputFile");

        const prefix = generateFilePrefix(inputFile.url);
        let index = 1;

        const outputFiles: S3Locator[] = [];

        switch (rekoJobType) {
            case "StartCelebrityRecognition":
                const celebrityRecognitionParams: Rekognition.GetCelebrityRecognitionRequest = {
                    JobId: rekoJobId,
                    SortBy: "TIMESTAMP",
                };

                do {
                    const response = await ctx.rekognition.getCelebrityRecognition(celebrityRecognitionParams).promise();
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3));
                    celebrityRecognitionParams.NextToken = response.NextToken;
                } while (celebrityRecognitionParams.NextToken);
                break;
            case "StartFaceDetection":
                const faceDetectionParams: Rekognition.GetFaceDetectionRequest = {
                    JobId: rekoJobId,
                };

                do {
                    const response = await ctx.rekognition.getFaceDetection(faceDetectionParams).promise();
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3));
                    faceDetectionParams.NextToken = response.NextToken;
                } while (faceDetectionParams.NextToken);
                break;
            case "StartLabelDetection":
                const labelDetectionParams: Rekognition.GetLabelDetectionRequest = {
                    JobId: rekoJobId,
                    SortBy: "TIMESTAMP",
                };

                do {
                    const response = await ctx.rekognition.getLabelDetection(labelDetectionParams).promise();
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3));
                    labelDetectionParams.NextToken = response.NextToken;
                } while (labelDetectionParams.NextToken);
                break;
            case "StartTextDetection":
                const textDetectionParams: Rekognition.GetTextDetectionRequest = {
                    JobId: rekoJobId,
                };

                do {
                    const response = await ctx.rekognition.getTextDetection(textDetectionParams).promise();
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3));
                    textDetectionParams.NextToken = response.NextToken;
                } while (textDetectionParams.NextToken);
                break;
            case "StartContentModeration":
                const contentModerationParams: Rekognition.GetContentModerationRequest = {
                    JobId: rekoJobId,
                    SortBy: "TIMESTAMP",
                };

                do {
                    const response = await ctx.rekognition.getContentModeration(contentModerationParams).promise();
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3));
                    contentModerationParams.NextToken = response.NextToken;
                } while (contentModerationParams.NextToken);
                break;
            case "StartSegmentDetection":
                const segmentDetectionParams: Rekognition.GetSegmentDetectionRequest = {
                    JobId: rekoJobId,
                };

                do {
                    const response = await ctx.rekognition.getSegmentDetection(segmentDetectionParams).promise();
                    outputFiles.push(await writeOutputFile(`${prefix}_${index++}.json`, response, ctx.s3));
                    segmentDetectionParams.NextToken = response.NextToken;
                } while (segmentDetectionParams.NextToken);
                break;
            default:
                throw new McmaException(`Rekognition job type '${rekoJobType} not implemented`);
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

