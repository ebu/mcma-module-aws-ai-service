import { Context } from "aws-lambda";
import * as AWSXRay from "aws-xray-sdk-core";
import { S3Client } from "@aws-sdk/client-s3";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { TranscribeClient } from "@aws-sdk/client-transcribe";

import { AuthProvider, ResourceManagerProvider } from "@mcma/client";
import { ProcessJobAssignmentOperation, ProviderCollection, Worker, WorkerRequest, WorkerRequestProperties } from "@mcma/worker";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { AwsCloudWatchLoggerProvider, getLogGroupName } from "@mcma/aws-logger";
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

const cloudWatchLogsClient = AWSXRay.captureAWSv3Client(new CloudWatchLogsClient({}));
const dynamoDBClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const rekognitionClient = AWSXRay.captureAWSv3Client((new RekognitionClient({})));
const s3Client = AWSXRay.captureAWSv3Client(new S3Client({}));
const transcribeClient = AWSXRay.captureAWSv3Client(new TranscribeClient({}));

const authProvider = new AuthProvider().add(awsV4Auth());
const dbTableProvider = new DynamoDbTableProvider({}, dynamoDBClient);
const loggerProvider = new AwsCloudWatchLoggerProvider("aws-ai-service-worker", getLogGroupName(), cloudWatchLogsClient);
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
            s3Client,
            rekognitionClient,
            transcribeClient,
        });
    } catch (error) {
        logger.error("Error occurred when handling operation '" + event.operationName + "'");
        logger.error(error);
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}

export type WorkerContext = {
    awsRequestId: string,
    rekognitionClient: RekognitionClient,
    s3Client: S3Client,
    transcribeClient: TranscribeClient
}
