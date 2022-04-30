import { ProcessJobAssignmentHelper, ProviderCollection } from "@mcma/worker";
import { AIJob, ConfigVariables } from "@mcma/core";
import { S3Locator } from "@mcma/aws-s3";
import { WorkerContext } from "../index";
import { generateFilePrefix, getFileExtension } from "./utils";
import { default as axios } from "axios";

const configVariables = ConfigVariables.getInstance();

export async function celebrityRecognition(providers: ProviderCollection, jobAssignmentHelper: ProcessJobAssignmentHelper<AIJob>, ctx: WorkerContext) {
    const logger = jobAssignmentHelper.logger;
    const jobInput = jobAssignmentHelper.jobInput;

    const inputFile = jobInput.get<S3Locator>("inputFile");
    const jobGuid = jobAssignmentHelper.jobAssignmentDatabaseId.substring(jobAssignmentHelper.jobAssignmentDatabaseId.lastIndexOf("/") + 1);

    const outputBucket = configVariables.get("OutputBucket");
    const tempKey = generateFilePrefix(inputFile.url) + getFileExtension(inputFile.url)

    logger.info(`Copying media file to bucket '${outputBucket}' with key '${tempKey}`);
    await ctx.s3.upload({
        Bucket: outputBucket,
        Key : tempKey,
        Body: (await axios.get(inputFile.url, { responseType: "stream" })).data,
    }).promise();

    logger.info("Starting celebrity recognition");

    const params = {
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

    const data = await ctx.rekognition.startCelebrityRecognition(params).promise();

    logger.debug(data);
}
