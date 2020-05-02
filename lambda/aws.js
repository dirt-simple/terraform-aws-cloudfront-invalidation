const AWS = require("aws-sdk");
const cloudfront = new AWS.CloudFront();
const sqs = new AWS.SQS({ region: process.env.AWS_REGION });
const RETRY_TIMEOUT = process.env.INVALIDATION_RETRY_TIMEOUT;

export function sendSqsMessage(message) {
  return sqs.sendMessage(message).promise();
}

export function makeSnsParams(message, sourceArn) {
  return {
    MessageBody: JSON.stringify({ Message: JSON.stringify(message) }),
    QueueUrl: getQueueUrlFromArn(sourceArn),
    DelaySeconds: RETRY_TIMEOUT
  };
}

export function createCloudfrontInvalidation(invalidation) {
  return cloudfront.createInvalidation(invalidation).promise();
}

export function makeInvalidationParams(message) {
  return {
    DistributionId: message.distribution_id,
    InvalidationBatch: {
      CallerReference: new Date().getTime().toString(),
      Paths: {
        Quantity: 1,
        Items: [message.path]
      }
    }
  };
}
export function getQueueUrlFromArn(arn) {
  const arnParts = arn.split(":", 6);
  return `https://sqs.${arnParts[3]}.amazonaws.com/${arnParts[4]}/${
    arnParts[5]
  }`;
}
