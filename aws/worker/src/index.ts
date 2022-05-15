import { Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";

import { AuthProvider, ResourceManagerProvider } from "@mcma/client";
import { ProcessJobAssignmentOperation, ProviderCollection, Worker, WorkerRequest, WorkerRequestProperties } from "@mcma/worker";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { AwsCloudWatchLoggerProvider } from "@mcma/aws-logger";
import { awsV4Auth } from "@mcma/aws-client";
import { AIJob } from "@mcma/core";
import {
    celebrityRecognition,
    contentModeration,
    faceDetection,
    labelDetection,
    processRekognitionResult,
    processTranscribeResult,
    segmentDetection,
    textDetection,
    transcription
} from "./operations";
import { Rekognition, S3, TranscribeService } from "aws-sdk";

const { LogGroupName } = process.env;

const AWS = AWSXRay.captureAWS(require("aws-sdk"));

const authProvider = new AuthProvider().add(awsV4Auth(AWS));
const dbTableProvider = new DynamoDbTableProvider();
const loggerProvider = new AwsCloudWatchLoggerProvider("aws-ai-service-worker", LogGroupName);
const resourceManagerProvider = new ResourceManagerProvider(authProvider);

const providerCollection = new ProviderCollection({
    authProvider,
    dbTableProvider,
    loggerProvider,
    resourceManagerProvider
});

const processJobAssignmentOperation =
    new ProcessJobAssignmentOperation(AIJob)
        .addProfile("AwsCelebrityRecognition", celebrityRecognition)
        .addProfile("AwsContentModeration", contentModeration)
        .addProfile("AwsFaceDetection", faceDetection)
        .addProfile("AwsLabelDetection", labelDetection)
        .addProfile("AwsSegmentDetection", segmentDetection)
        .addProfile("AwsTextDetection", textDetection)
        .addProfile("AwsTranscription", transcription);

const worker =
    new Worker(providerCollection)
        .addOperation(processJobAssignmentOperation)
        .addOperation("ProcessRekognitionResult", processRekognitionResult)
        .addOperation("ProcessTranscribeResult", processTranscribeResult);

export async function handler(event: WorkerRequestProperties, context: Context) {
    const logger = loggerProvider.get(context.awsRequestId, event.tracker);

    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        await worker.doWork(new WorkerRequest(event, logger), {
            awsRequestId: context.awsRequestId,
            s3: new AWS.S3({ signatureVersion: "v4" }),
            rekognition: new AWS.Rekognition(),
            transcribeService: new AWS.TranscribeService(),
        });
    } catch (error) {
        logger.error("Error occurred when handling operation '" + event.operationName + "'");
        logger.error(error.toString());
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}

export type WorkerContext = {
    awsRequestId: string,
    s3: S3,
    rekognition: Rekognition,
    transcribeService: TranscribeService
}
