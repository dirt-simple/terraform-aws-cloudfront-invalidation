#!/usr/bin/env bash

DISTRO="E2BI2JKRCBVCV7"
REGION="us-east-1"
ACCT_ID="YOUR_ACCT_NUM"

for i in {1..50}
do
    JSON=$(cat <<EOF
    {
        "TopicArn": "arn:aws:sns:${REGION}:${ACCT_ID}:cloudfront-invalidation",
        "Message": "{\"path\": \"/${i}/*\", \"distribution_id\": \"${DISTRO}\"}",
        "Subject": "test"
    }
EOF
)

    aws sns publish --cli-input-json "${JSON}"
done
