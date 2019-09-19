"use strict";

import { logWarning, logRetry, log } from "./loggers";
import {
  sendSqsMessage,
  createCloudfrontInvalidation,
  makeInvalidationParams,
  makeSnsParams
} from "./aws";
import { asyncForEach, parseMessage } from "./utils";

const NUM_OF_RETRIES = process.env.INVALIDATION_MAX_RETRIES;

const handleInvalidationError = async err => {
  if (err.code !== "TooManyInvalidationsInProgress") {
    const warning = `ignoring error: ${err}.`;
    logWarning(warning);
    return Promise.resolve();
  }

  if (shouldRetry(message)) {
    try {
      return await retryMessage(message);
    } catch (err) {
      log(err);
      return Promise.resolve("failed to send message for retry");
    }
  } else {
    const warning = `Failed after ${NUM_OF_RETRIES} retries`;
    logWarning(warning);
    return Promise.resolve(warning);
  }
};

async function retryMessage(message) {
  message.retry_count++;
  // This Message must be in SNS => SQS Format for incoming parsing to work
  const params = makeSnsParams(message, record.eventSourceARN);
  logRetry(
    `retrying ${invalidationParams.DistributionId}:${invalidationParams.Paths}`,
    params
  );
  return await sendSqsMessage(params);
}

function shouldRetry(message) {
  let retried = message.retry_count || 0;
  return retried < NUM_OF_RETRIES - 1;
}

exports.handler = async function(event) {
  await asyncForEach(event.Records, async record => {
    const message = parseMessage(record);
    log("SQS Message: ", message);

    if (!message.distribution_id || !message.path) {
      logWarning(
        'bad format. desired SNS message format: {"distribution_id": "<distid>", "path": "/a/path/*"}'
      );
      return Promise.resolve();
    }

    try {
      const successfulInvalidation = await createCloudfrontInvalidation(
        makeInvalidationParams(message)
      );
      log(successfulInvalidation);
      return Promise.resolve();
    } catch (e) {
      return await handleInvalidationError(e);
    }
  });
  return "A-OK";
};
