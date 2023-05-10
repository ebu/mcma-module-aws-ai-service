import * as AWSXRay from "aws-xray-sdk-core";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { Context, SNSEvent } from "aws-lambda";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { McmaException } from "@mcma/core";
import { getTableName } from "@mcma/data";
import { AwsCloudWatchLoggerProvider, getLogGroupName } from "@mcma/aws-logger";
import { LambdaWorkerInvoker } from "@mcma/aws-lambda-worker-invoker";
import { getWorkerFunctionId } from "@mcma/worker-invoker";

const cloudWatchLogsClient = AWSXRay.captureAWSv3Client(new CloudWatchLogsClient({}));
const dynamoDBClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const lambdaClient = AWSXRay.captureAWSv3Client(new LambdaClient({}));

const dbTableProvider = new DynamoDbTableProvider({}, dynamoDBClient);
const loggerProvider = new AwsCloudWatchLoggerProvider("aws-ai-service-sns-handler", getLogGroupName(), cloudWatchLogsClient);
const workerInvoker = new LambdaWorkerInvoker(lambdaClient);

export async function handler(event: SNSEvent, context: Context) {
    const logger = loggerProvider.get(context.awsRequestId);
    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        for (const record of event.Records) {
            try {

                // check if the payload contains data from SNS
                if (!record.Sns) {
                    continue;
                }

                if (!record.Sns.Message) {
                    continue;
                }

                const message = JSON.parse(record.Sns.Message);
                logger.debug(message);

                const rekognitionJobId = message.JobId;
                const rekognitionJobType = message.API;
                const rekognitionJobStatus = message.Status;
                const jobAssignmentDatabaseId = "/job-assignments/" + message.JobTag;

                logger.debug("rekoJobId:", rekognitionJobId);
                logger.debug("rekoJobType:", rekognitionJobType);
                logger.debug("status:", rekognitionJobStatus);
                logger.debug("jobAssignmentDatabaseId:", jobAssignmentDatabaseId);

                const table = await dbTableProvider.get(getTableName());
                const jobAssignment = await table.get(jobAssignmentDatabaseId);
                if (!jobAssignment) {
                    throw new McmaException("Failed to find JobAssignment with id: " + jobAssignmentDatabaseId);
                }

                // invoking worker lambda function that will process the results of transcription job
                await workerInvoker.invoke(
                    getWorkerFunctionId(),
                    {
                        operationName: "ProcessRekognitionResult",
                        input: {
                            jobAssignmentDatabaseId,
                            jobInfo: {
                                rekoJobId: rekognitionJobId,
                                rekoJobType: rekognitionJobType,
                                status: rekognitionJobStatus
                            }
                        },
                        tracker: jobAssignment.tracker
                    });
            } catch (error) {
                logger.error("Failed processing record", record);
                logger.error(error);
            }
        }
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}
