#! /bin/bash
cd "$(dirname "$0")"
rm -f index.js

# Compile to js
yarn build

# Deploy to gcp
gcloud functions deploy scrapeBookingReviews \
  --trigger-topic SCRAPE_BOOKING_REVIEWS \
  --runtime nodejs8 \
  --memory 1024MB \
  --timeout 300 \
  --region asia-northeast1 \
  --service-account "cloud-function@assetgenius.iam.gserviceaccount.com"

# Clean up
rm -f index.js
