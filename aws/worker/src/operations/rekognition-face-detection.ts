import { StartFaceDetectionCommand } from "@aws-sdk/client-rekognition";
import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { AIJob, ConfigVariables } from "@mcma/core";
import { S3Locator } from "@mcma/aws-s3";
import { WorkerContext } from "../index";
import { generateFilePrefix, getFileExtension, uploadUrlToS3 } from "./utils";

const configVariables = ConfigVariables.getInstance();

export async function faceDetection(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<AIJob>, ctx: WorkerContext) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    const inputFile = jobInput.inputFile as S3Locator;
    const jobGuid = jobAssignmentHelper.jobAssignmentDatabaseId.substring(jobAssignmentHelper.jobAssignmentDatabaseId.lastIndexOf("/") + 1);

    const outputBucket = configVariables.get("OUTPUT_BUCKET");
    const tempKey = generateFilePrefix(inputFile.url) + getFileExtension(inputFile.url);

    logger.info(`Copying media file to bucket '${outputBucket}' with key '${tempKey}`);
    await uploadUrlToS3(tempKey, inputFile.url, ctx.s3Client);

    logger.info("Starting face detection");

    const data = await ctx.rekognitionClient.send(new StartFaceDetectionCommand({
        Video: {
            S3Object: {
                Bucket: outputBucket,
                Name: tempKey,
            }
        },
        ClientRequestToken: jobGuid,
        FaceAttributes: "ALL",
        JobTag: jobGuid,
        NotificationChannel: {
            RoleArn: configVariables.get("REKOGNITION_ROLE"),
            SNSTopicArn: configVariables.get("SNS_TOPIC"),
        }
    }));

    logger.debug(data);
}
