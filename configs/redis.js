import Redis from "ioredis";

let redisClient;

const connectRedis = async () => {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 10000,
    });
  }

  try {
    if (redisClient.status !== "ready") {
      await new Promise((resolve, reject) => {
        const onReady = () => {
          redisClient.removeListener("error", onError);
          resolve();
        };
        const onError = (error) => {
          redisClient.removeListener("ready", onReady);
          reject(error);
        };
        redisClient.once("ready", onReady);
        redisClient.once("error", onError);
      });
    }
    await redisClient.ping();
  } catch (error) {
    redisClient.disconnect();
    redisClient = undefined;
    throw new Error(`Redis connection failed: ${error.message}`);
  }
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