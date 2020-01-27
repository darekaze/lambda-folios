#! /bin/bash
cd "$(dirname "$0")"
rm -f index.js

# Compile to js
yarn build

# Deploy to gcp
gcloud functions deploy storageTriggerDS \
  --runtime nodejs8 \
  --trigger-resource ag-booking-hotels \
  --trigger-event google.storage.object.finalize \
  --memory 128MB \
  --region asia-northeast1 \
  --service-account "cloud-function@assetgenius.iam.gserviceaccount.com"

# Clean up
rm -f index.js
