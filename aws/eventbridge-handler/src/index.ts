import * as AWSXRay from "aws-xray-sdk-core";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { Context, EventBridgeEvent } from "aws-lambda";
import { DynamoDbTableProvider } from "@mcma/aws-dynamodb";
import { AwsCloudWatchLoggerProvider, getLogGroupName } from "@mcma/aws-logger";
import { LambdaWorkerInvoker } from "@mcma/aws-lambda-worker-invoker";
import { ConfigVariables, McmaException } from "@mcma/core";
import { getWorkerFunctionId } from "@mcma/worker-invoker";
import { getTableName } from "@mcma/data";

const cloudWatchLogsClient = AWSXRay.captureAWSv3Client(new CloudWatchLogsClient({}));
const dynamoDBClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const lambdaClient = AWSXRay.captureAWSv3Client(new LambdaClient({}));

const dbTableProvider = new DynamoDbTableProvider({}, dynamoDBClient);
const loggerProvider = new AwsCloudWatchLoggerProvider("aws-ai-service-eventbridge-handler", getLogGroupName(), cloudWatchLogsClient);
const workerInvoker = new LambdaWorkerInvoker(lambdaClient);

interface TranscribeJobStateChangeDetail {
    TranscriptionJobName: string,
    TranscriptionJobStatus: string,
}

const TranscribeJobStateChangeDetailType = "Transcribe Job State Change";

const configVariables = ConfigVariables.getInstance();

export async function handler(event: EventBridgeEvent<string, any>, context: Context) {
    const logger = loggerProvider.get(context.awsRequestId);
    try {
        logger.functionStart(context.awsRequestId);
        logger.debug(event);
        logger.debug(context);

        const prefix = configVariables.get("PREFIX");
        let jobAssignmentDatabaseId, operationName;
        let jobInfo: {[key: string]: any} = {};

        switch (event["detail-type"]) {
            case TranscribeJobStateChangeDetailType:
                const detail = event.detail as TranscribeJobStateChangeDetail;

                if (detail.TranscriptionJobName.startsWith(prefix)) {
                    const jobGuid = detail.TranscriptionJobName.substring(prefix.length + 1);
                    jobAssignmentDatabaseId = "/job-assignments/" + jobGuid;
                    operationName = "ProcessTranscribeResult";
                    jobInfo = detail;
                }
                break;
            default:
                logger.warn(`Unexpected event type '${event["detail-type"]}'`);
                return;
        }

        const table = await dbTableProvider.get(getTableName());
        const jobAssignment = await table.get(jobAssignmentDatabaseId);
        if (!jobAssignment) {
            throw new McmaException("Failed to find JobAssignment with id: " + jobAssignmentDatabaseId);
        }

        await workerInvoker.invoke(
            getWorkerFunctionId(),
            {
                operationName,
                input: {
                    jobAssignmentDatabaseId,
                    jobInfo,
                },
                tracker: jobAssignment.tracker
            });
    } finally {
        logger.functionEnd(context.awsRequestId);
        await loggerProvider.flush();
    }
}
