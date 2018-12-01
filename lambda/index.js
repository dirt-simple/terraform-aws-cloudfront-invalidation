"use strict";
const AWS = require("aws-sdk");
const cloudfront = new AWS.CloudFront();
const sqs = new AWS.SQS({region: process.env.AWS_REGION});

const NUM_OF_RETRIES = process.env.INVALIDATION_MAX_RETRIES;
const RETRY_TIMOUT = process.env.INVALIDATION_RETRY_TIMOUT;

exports.handler = (event, context, callback) => {

    event.Records.forEach(record => {

        const body = JSON.parse(record.body);
        const message = JSON.parse(body.Message);

        console.info("SQS Message: ", message);

        if (!message.distribution_id || !message.path) {
            const msg = `[WARNING] bad format. desired SNS message format: {\"distribution_id\": \"<distid>\", \"path\": \"/a/path/*\"}`;
            console.log(msg);
            callback(null, msg);
            return;
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

        cloudfront.createInvalidation(invalidationParams, (err, data) => {
            if (err) {
                if (err.code !== "TooManyInvalidationsInProgress") {
                    const msg = `[WARNING] ignoring error: ${err}.`;
                    console.log(msg);
                    callback(null, msg);
                    return;
                }

                let retried = message.retry_count || 0;
                if (retried > NUM_OF_RETRIES - 1) {
                    const msg = `[WARNING] Failed after ${NUM_OF_RETRIES} retries`;
                    console.log(msg);
                    callback(null, msg);
                    return;

                } else {
                    retried++;
                    message.retry_count = retried;

                    const arn = record.eventSourceARN.split(":", 6);
                    const queueUrl =
                        "https://sqs." + arn[3] + ".amazonaws.com/" + arn[4] + "/" + arn[5];

                    // This Message must be in SNS => SQS Format for incoming parsing to work
                    const params = {
                        MessageBody: JSON.stringify({Message: JSON.stringify(message)}),
                        QueueUrl: queueUrl,
                        DelaySeconds: RETRY_TIMOUT
                    };
                    const msg = `[RETRY] retrying ${invalidationParams.DistributionId}:${
                        invalidationParams.Paths
                        }`;
                    console.log(params);

                    sqs.sendMessage(params, (err, data) => {
                        if (err) {
                            console.log(err);
                            callback("failed to send message for retry");
                            return;
                        }
                        const msg = `[RETRY] Scheduling a retry in ${RETRY_TIMOUT} seconds. ${retried} retries`;
                        console.log(msg);
                        callback(null, msg);
                        return;

                    });
                }
            } else
                console.log(data);

        });

    });

    callback(null, "A-OK");
};
