import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { AIJob, ConfigVariables } from "@mcma/core";
import { S3Locator } from "@mcma/aws-s3";
import { WorkerContext } from "../index";
import { generateFilePrefix, getFileExtension, uploadUrlToS3 } from "./utils";
import { StartTextDetectionRequest } from "aws-sdk/clients/rekognition";

const configVariables = ConfigVariables.getInstance();

export async function textDetection(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<AIJob>, ctx: WorkerContext) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    const inputFile = jobInput.inputFile as S3Locator;
    const jobGuid = jobAssignmentHelper.jobAssignmentDatabaseId.substring(jobAssignmentHelper.jobAssignmentDatabaseId.lastIndexOf("/") + 1);

    const outputBucket = configVariables.get("OutputBucket");
    const tempKey = generateFilePrefix(inputFile.url) + getFileExtension(inputFile.url);

    logger.info(`Copying media file to bucket '${outputBucket}' with key '${tempKey}`);
    await uploadUrlToS3(tempKey, inputFile.url, ctx.s3);

    logger.info("Starting text labels");

    const params: StartTextDetectionRequest = {
        Video: {
            S3Object: {
                Bucket: outputBucket,
                Name: tempKey,
            }
        },
        ClientRequestToken: jobGuid,
        JobTag: jobGuid,
        NotificationChannel: {
            RoleArn: configVariables.get("RekognitionRole"),
            SNSTopicArn: configVariables.get("SnsTopic"),
        }
    };

    const data = await ctx.rekognition.startTextDetection(params).promise();

    logger.debug(data);
}
