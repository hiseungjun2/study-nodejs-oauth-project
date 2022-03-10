// @ts-check
const { v1: uuidv1 } = require('uuid')
const express = require('express')
const { getPostsCollection } = require('../mongo')
const { redirectWithMsg } = require('../util')

const router = express.Router()

// 게시글 등록
router.post('/', async (req, res) => {
  if (!req.user) {
    res.status(403).end()
    return
  }

  const posts = await getPostsCollection()
  const { content } = req.body

  posts.insertOne({
    id: uuidv1(),
    userId: req.user.id,
    content,
    createdAt: new Date(),
  })

  redirectWithMsg({
    res,
    dest: '/',
    info: '포스트가 작성되었습니다.',
  })
})

// 게시글 삭제
router.post('/:postId/delete', async (req, res) => {
  const { postId } = req.params

  const posts = await getPostsCollection()

  const existingPost = await posts.findOne({
    id: postId,
  })

  if (existingPost.userId !== req.user.id) {
    res.status(403).end()
    return
  }

  await posts.deleteOne({
    id: postId,
  })

  redirectWithMsg({
    res,
    dest: '/',
    info: '포스트가 삭제되었습니다.',
  })
})

// 게시글 수정
router.post('/:postId/update', async (req, res) => {
  const { postId } = req.params
  const { content } = req.body

  const posts = await getPostsCollection()

  const existingPost = await posts.findOne({
    id: postId,
  })

  if (existingPost.userId !== req.user.id) {
    res.status(403).end()
    return
  }

  await posts.updateOne(
    {
      id: postId,
    },
    {
      $set: {
        constent: content,
      },
    }
  )

  redirectWithMsg({
    res,
    dest: '/',
    info: '포스트가 삭제되었습니다.',
  })
})

module.exports = router
