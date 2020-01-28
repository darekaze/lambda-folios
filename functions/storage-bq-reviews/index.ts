/* eslint-disable no-console */
import { Storage } from '@google-cloud/storage'

// See https://cloud.google.com/storage/docs/json_api/v1/objects#resource
interface GCSMessage {
  name: string
  bucket: string
}

interface Review {
  hotel_name: string
  hotel_address: string
  avg_score: number
  total_review_count: number
  useful_review_count: number
  review_date: string
  reviewer_nationality: string
  reviewer_score: number
  title: string
  positive: string
  negative: string
  stayed_room: string
  stayed_night: number
  scraped_at: string
}

export const storageBQReviews = async (data: GCSMessage) => {
  const storage = new Storage()
  const file = storage.bucket(data.bucket).file(data.name)

  const buf = (await file.download())[0]
  const reviewList: Review[] = JSON.parse(buf.toString())

  // TODO: insert data into big query according to month?

  return console.log('All Done!')
}
