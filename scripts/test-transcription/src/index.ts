import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";

import { v4 as uuidv4 } from "uuid";
import { S3Client, HeadObjectCommand, PutObjectCommand, PutObjectCommandInput, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { fromIni } from "@aws-sdk/credential-providers";

import { AuthProvider, ResourceManager, ResourceManagerConfig } from "@mcma/client";
import { AIJob, Job, JobParameterBag, JobProfile, JobStatus, McmaException, McmaTracker, Utils } from "@mcma/core";
import { S3Locator } from "@mcma/aws-s3";
import { awsV4Auth } from "@mcma/aws-client";

const credentials = fromIni();

const JOB_PROFILE = "AwsTranscription";

const TERRAFORM_OUTPUT = "../../deployment/terraform.output.json";

const MEDIA_FILE = "C:/Media/Demo/Tom Hanks' Amazing Clint Eastwood Impression - The Graham Norton Show.mp4";

const s3Client = new S3Client({ credentials });

export function log(entry?: any) {
    if (typeof entry === "object") {
        console.log(JSON.stringify(entry, null, 2));
    } else {
        console.log(entry);
    }
}

async function uploadFileToBucket(bucket: string, filename: string) {
    const fileStream = fs.createReadStream(filename);
    fileStream.on("error", function (err) {
        console.log("File Error", err);
    });

    const params: PutObjectCommandInput = {
        Bucket: bucket,
        Key: path.basename(filename),
        Body: fileStream,
        ContentType: mime.lookup(filename) || "application/octet-stream"
    };

    let isPresent = true;

    try {
        console.log("checking if file is already present");
        await s3Client.send(new HeadObjectCommand({ Bucket: params.Bucket, Key: params.Key }));
        console.log("Already present. Not uploading again");
    } catch (error) {
        isPresent = false;
    }

    if (!isPresent) {
        console.log("Not present. Uploading");
        await s3Client.send(new PutObjectCommand(params));
    }

    const command = new GetObjectCommand({
        Bucket: params.Bucket,
        Key: params.Key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return new S3Locator({ url });
}

async function waitForJobCompletion(job: Job, resourceManager: ResourceManager): Promise<Job> {
    console.log("Job is " + job.status);

    while (job.status !== JobStatus.Completed &&
           job.status !== JobStatus.Failed &&
           job.status !== JobStatus.Canceled) {

        await Utils.sleep(1000);
        job = await resourceManager.get<Job>(job.id);
        console.log("Job is " + job.status);
    }

    return job;
}

async function startJob(resourceManager: ResourceManager, inputFile: S3Locator) {
    let [jobProfile] = await resourceManager.query(JobProfile, { name: JOB_PROFILE });

    // if not found bail out
    if (!jobProfile) {
        throw new McmaException(`JobProfile '${JOB_PROFILE}' not found`);
    }

    let job = new AIJob({
        jobProfileId: jobProfile.id,
        jobInput: new JobParameterBag({
            inputFile
        }),
        tracker: new McmaTracker({
            "id": uuidv4(),
            "label": `Test - ${JOB_PROFILE}`
        })
    });

    return resourceManager.create(job);
}

async function testJob(resourceManager: ResourceManager, inputFile: S3Locator) {
    let job;

    console.log("Creating job");
    job = await startJob(resourceManager, inputFile);

    console.log("job.id = " + job.id);
    job = await waitForJobCompletion(job, resourceManager);

    console.log(JSON.stringify(job, null, 2));
}

async function main() {
    console.log("Starting test service");

    const terraformOutput = JSON.parse(fs.readFileSync(TERRAFORM_OUTPUT, "utf8"));
    const uploadBucket = terraformOutput.upload_bucket.value;

    const serviceRegistryUrl = terraformOutput.service_registry.value.service_url;
    const serviceRegistryAuthType = terraformOutput.service_registry.value.auth_type;

    const resourceManagerConfig: ResourceManagerConfig = {
        serviceRegistryUrl,
        serviceRegistryAuthType,
    };

    const resourceManager = new ResourceManager(resourceManagerConfig, new AuthProvider().add(awsV4Auth({ credentials })));

    console.log(`Uploading media file ${MEDIA_FILE}`);
    const mediaFileLocator = await uploadFileToBucket(uploadBucket, MEDIA_FILE);

    await testJob(resourceManager, mediaFileLocator);
}

main().then(() => console.log("Done")).catch(e => console.error(e));
