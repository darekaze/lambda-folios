/* eslint-disable no-console */
import { PubSub } from '@google-cloud/pubsub'
import { Storage } from '@google-cloud/storage'

// see https://cloud.google.com/storage/docs/json_api/v1/objects#resource
export const storageTriggerReview = async (data: any) => {
  const storage = new Storage()
  const file = storage.bucket(data.bucket).file(data.name)

  const buf = (await file.download())[0]
  const hotelList = JSON.parse(buf.toString())

  console.log(hotelList)
}
