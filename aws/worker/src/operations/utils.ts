import { S3 } from "aws-sdk";
import { S3Locator } from "@mcma/aws-s3";
import { default as axios } from "axios";
import { Utils } from "@mcma/core";

const { OutputBucket, OutputBucketPrefix } = process.env;

export function generateFilePrefix(url: string) {
    let filename = Utils.parseUrl(url).pathname;
    let pos = filename.lastIndexOf("/");
    if (pos >= 0) {
        filename = filename.substring(pos + 1);
    }
    pos = filename.lastIndexOf(".");
    if (pos >= 0) {
        filename = filename.substring(0, pos);
    }

    return `${OutputBucketPrefix}${new Date().toISOString().substring(0, 19).replace(/[:]/g, "-")}/${filename}`;
}

export function getFileExtension(url: string, withDot: boolean = true) {
    let filename = Utils.parseUrl(url).pathname;
    let pos = filename.lastIndexOf("/");
    if (pos >= 0) {
        filename = filename.substring(pos + 1);
    }
    pos = filename.lastIndexOf(".");
    if (pos >= 0) {
        return filename.substring(pos + (withDot ? 0 : 1));
    }
    return "";
}

export async function writeOutputFile(filename: string, contents: any, s3: S3): Promise<S3Locator> {
    const outputFile = new S3Locator({
        url: s3.getSignedUrl("getObject", {
            Bucket: OutputBucket,
            Key: filename,
            Expires: 12 * 3600
        })
    });

    await s3.putObject({
        Bucket: outputFile.bucket,
        Key: outputFile.key,
        Body: JSON.stringify(contents)
    }).promise();

    return outputFile;
}

export async function uploadUrlToS3(filename: string, url: string, s3: S3) {
    const outputFile = new S3Locator({
        url: s3.getSignedUrl("getObject", {
            Bucket: OutputBucket,
            Key: filename,
            Expires: 12 * 3600
        })
    });

    await s3.upload({
        Bucket: outputFile.bucket,
        Key: outputFile.key,
        Body: (await axios.get(url, { responseType: "stream" })).data,
    }).promise();

    return outputFile;
}
