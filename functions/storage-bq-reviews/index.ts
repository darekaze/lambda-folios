/* eslint-disable no-console */
import { Storage } from '@google-cloud/storage'
import { BigQuery } from '@google-cloud/bigquery'

// See https://cloud.google.com/storage/docs/json_api/v1/objects#resource
interface GCSMessage {
  name: string
  bucket: string
}

export const storageBQReviews = async (data: GCSMessage) => {
  const storage = new Storage()
  const bigquery = new BigQuery()

  const [year, month] = data.name.split('_')[0].split('-')

  const file = storage.bucket(data.bucket).file(data.name)
  const dataset = bigquery.dataset('booking_hotel_reviews')
  const tableId = `reviews_${year}${month}`
  const metadata = {
    sourceFormat: 'CSV',
    skipLeadingRows: 1,
    schema: {
      fields: [
        { name: 'hotel_name', type: 'STRING' },
        { name: 'hotel_address', type: 'STRING' },
        { name: 'avg_score', type: 'FLOAT' },
        { name: 'total_review_count', type: 'INTEGER' },
        { name: 'useful_review_count', type: 'INTEGER' },
        { name: 'review_date', type: 'DATE' },
        { name: 'reviewer_nationality', type: 'STRING' },
        { name: 'reviewer_score', type: 'FLOAT' },
        { name: 'title', type: 'STRING' },
        { name: 'positive', type: 'STRING' },
        { name: 'negative', type: 'STRING' },
        { name: 'stayed_room', type: 'STRING' },
        { name: 'stayed_night', type: 'INTEGER' },
        { name: 'scraped_at', type: 'DATE' },
      ],
    },
  }

  // Load data from GCS file into the table
  const [job] = await dataset.table(tableId).load(file, metadata)

  // load() waits for the job to finish
  console.log(`Job ${job.id} completed.`)

  // Check the job's status for errors
  const { errors } = job.status
  if (errors && errors.length > 0) {
    throw errors
  }
}
