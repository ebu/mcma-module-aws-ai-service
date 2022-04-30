import { JobStatus, McmaException, ProblemDetail } from "@mcma/core";
import { getTableName } from "@mcma/data";
import { ProcessJobAssignmentHelper, ProviderCollection, WorkerRequest } from "@mcma/worker";
import { S3Locator } from "@mcma/aws-s3";
import { Rekognition } from "aws-sdk";
import { generateFilePrefix } from "./utils";
import { WorkerContext } from "../index";

const { OutputBucket } = process.env;

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
        let results: any;

        switch (rekoJobType) {
            case "StartCelebrityRecognition":
                const celebrityRecognitionParams: Rekognition.GetCelebrityRecognitionRequest = {
                    JobId: rekoJobId,
                    SortBy: "TIMESTAMP",
                };

                let celebrityResults: Rekognition.GetCelebrityRecognitionResponse;

                do {
                    const response = await ctx.rekognition.getCelebrityRecognition(celebrityRecognitionParams).promise();

                    if (!celebrityResults) {
                        celebrityResults = response;
                    } else {
                        celebrityResults.Celebrities.push(...response.Celebrities);
                    }

                    celebrityRecognitionParams.NextToken = celebrityResults.NextToken;
                } while (celebrityRecognitionParams.NextToken);

                results = celebrityResults;
                break;
            case "StartFaceDetection":
                const faceDetectionParams: Rekognition.GetFaceDetectionRequest = {
                    JobId: rekoJobId,
                };

                let faceDetectionResults: Rekognition.GetFaceDetectionResponse;

                do {
                    const response = await ctx.rekognition.getFaceDetection(faceDetectionParams).promise();

                    if (!faceDetectionResults) {
                        faceDetectionResults = response;
                    } else {
                        faceDetectionResults.Faces.push(...response.Faces);
                    }

                    faceDetectionParams.NextToken = response.NextToken;
                } while (faceDetectionParams.NextToken);

                results = faceDetectionResults;
                break;
            case "StartLabelDetection":
            case "StartContentModeration":
            case "StartPersonTracking":
            case "StartFaceSearch":
                throw new McmaException(rekoJobType + " : Not implemented");
            default:
                throw new McmaException("Unknown rekoJobType");
        }

        const inputFile = jobAssignmentHelper.jobInput.get<S3Locator>("inputFile");

        const outputFile = new S3Locator({
            url: ctx.s3.getSignedUrl("getObject", {
                Bucket: OutputBucket,
                Key: generateFilePrefix(inputFile.url) + ".json",
                Expires: 12 * 3600
            })
        });

        await ctx.s3.putObject({
            Bucket: outputFile.bucket,
            Key: outputFile.key,
            Body: JSON.stringify(results)
        }).promise();

        jobAssignmentHelper.jobOutput.set("outputFile", outputFile);

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
