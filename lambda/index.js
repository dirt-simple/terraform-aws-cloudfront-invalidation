"use strict";
const AWS = require("aws-sdk");
const cloudfront = new AWS.CloudFront();
const sqs = new AWS.SQS({region: process.env.AWS_REGION});

const NUM_OF_RETRIES = process.env.INVALIDATION_MAX_RETRIES;
const RETRY_TIMOUT = process.env.INVALIDATION_RETRY_TIMOUT;

const processInvalidation = async (record) => {
    const body = JSON.parse(record.body);
    const message = JSON.parse(body.Message);

    console.info("SQS Message: ", message);

    if (!message.distribution_id || !message.path) {
        return `[WARNING] bad format. desired SNS message format: {\"distribution_id\": \"<distid>\", \"path\": \"/a/path/*\"}`;
    }

    const invalidationParams = {
        DistributionId: message.distribution_id,
        InvalidationBatch: {
            CallerReference: new Date().getTime().toString(),
            Paths: {
                Quantity: 1,
                Items: [message.path]
            }
        }
    };

    try {
        await cloudfront.createInvalidation(invalidationParams).promise()
    } catch (err) {
        if (err.code !== "TooManyInvalidationsInProgress") {
            return `[WARNING] ignoring error: ${err}.`;
        }

        let retried = message.retry_count || 0;
        if (retried > NUM_OF_RETRIES - 1) {
            return `[WARNING] Failed after ${NUM_OF_RETRIES} retries`;
        } else {
            retried++;
            message.retry_count = retried;

            const arn = record.eventSourceARN.split(":", 6);
            const queueUrl = `https://sqs.${arn[3]}.amazonaws.com/${arn[4]}/${arn[5]}`

            // This Message must be in SNS => SQS Format for incoming parsing to work
            const params = {
                MessageBody: JSON.stringify({Message: JSON.stringify(message)}),
                QueueUrl: queueUrl,
                DelaySeconds: RETRY_TIMOUT
            };

            console.log(params);

            try {
                await sqs.sendMessage(params).promise()
                return `[RETRY] Scheduling a retry in ${RETRY_TIMOUT} seconds. ${retried} retries`;
            } catch (err) {
                return "failed to send message for retry"
            }
        }
    }
}

exports.handler = async event => {
    await Promise.all(event.Records.map(async record => {
        await processInvalidation(record)
    }))
};
