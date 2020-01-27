/* eslint-disable no-console */
import { PubSub } from '@google-cloud/pubsub'
import { Storage } from '@google-cloud/storage'

// See https://cloud.google.com/storage/docs/json_api/v1/objects#resource
interface GCSMessage {
  name: string
  bucket: string
}

export const storageTriggerReview = async (data: GCSMessage) => {
  const pubSubClient = new PubSub()
  const storage = new Storage()
  const file = storage.bucket(data.bucket).file(data.name)
  const reviewTopic = pubSubClient.topic('SCRAPE_BOOKING_REVIEWS')

  const buf = (await file.download())[0]
  const hotelList: any[] = JSON.parse(buf.toString())

  // Trigger pubsub for review
  await Promise.all(
    hotelList.map(async item => {
      const dataBuffer = Buffer.from(JSON.stringify({ url: item.url }), 'utf8')

      try {
        const messageId = await reviewTopic.publish(dataBuffer)
        console.log(`Message ${messageId} published.`)
      } catch (err) {
        console.error(err)
      }
    }),
  )

  return console.log('All Done!')
}
