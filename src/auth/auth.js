// @ts-check

const { v4: uuidv4 } = require('uuid')
const { signJWT } = require('./jwt')
const { getUsersCollection } = require('../mongo')

/**
 * @param {string} userId
 */
async function getAccessTokenForUserId(userId) {
  return signJWT(userId)
}

/**
 * @typedef Input
 * @property {string} platformUserId
 * @property {string} platform
 * @property {string} [nickname]
 * @property {string} [profileImageURL]
 */

/**
 * @typedef Output
 * @property {string} userId
 * @property {string} accessToken
 */

/**
 * @param {Input} param0
 * @returns {Promise<Output>}
 */
async function createUserOrLogin({
  platformUserId,
  platform,
  nickname,
  profileImageURL,
}) {
  const users = await getUsersCollection()

  const existingUser = await users.findOne({
    platform,
    platformUserId,
  })

  // TODO
  // 기존 유저가 존재한다면
  if (existingUser) {
    return {
      userId: existingUser.id,
      accessToken: await signJWT(existingUser.id),
    }
  }

  const userId = uuidv4() // 유저 키 값 생성

  await users.insertOne({
    id: userId,
    platformUserId, // 해당 플랫폼에서의 user id
    platform, // kakao, facebook, naver
    nickname,
    profileImageURL,
    verified: true, // 해당 값이 true 이여야만 앱 내에서 정상적인 활동이 가능
  })

  return {
    userId,
    accessToken: await signJWT(userId),
  }
}

/**
 * @param {import('express').Response} res
 * @param {string} token
 */
function setAccessTokenCookie(res, token) {
  res.cookie('access_token', token, {
    httpOnly: true,
    secure: true,
  })
}

/**
 * @param {string} password
 * @returns {Promise<string>}
 */
async function encryptPassword(password) {
  return new Promise((resolve, reject) => {
    // TODO
  })
}

/**
 * @param {string} plainText
 * @param {string} password
 * @returns {Promise<boolean>}
 */
async function comparePassword(plainText, password) {
  return new Promise((resolve, reject) => {
    // TODO
  })
}

module.exports = {
  getAccessTokenForUserId,
  createUserOrLogin,
  setAccessTokenCookie,
  encryptPassword,
  comparePassword,
}
