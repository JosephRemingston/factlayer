import Redis from "ioredis";

let redisClient;

const connectRedis = async () => {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }

  await redisClient.ping();
  console.log("Redis connected");
  return redisClient;
};

const getRedis = () => {
  if (!redisClient) {
    throw new Error("Redis has not been connected");
  }
  return redisClient;
};

export { connectRedis, getRedis };