// @ts-check

const { SESV2 } = require('aws-sdk')
const { v4: uuidv4 } = require('uuid')
const express = require('express')

const { APP_CONFIG_JSON } = require('../common')
const { getUsersCollection, getPostsCollection } = require('../mongo')
const {
  setAccessTokenCookie,
  encryptPassword,
  comparePassword,
  getAccessTokenForUserId,
} = require('../auth/auth')
const { signJWT } = require('../auth/jwt')
const { redirectWithMsg } = require('../util')

const router = express.Router()

const ses = new SESV2()

router.get('/', async (req, res) => {
  /*
   - 다른 사람의 글에는 삭제 버튼을 보여주지 말 것
   - 내 닉네임 혹은 이메일이 보일 것
   - 가장 최근에 만들어진 글이 맨 위로 올 것
   */

  if (req.user) {
    const postsCol = await getPostsCollection()

    const postsCursor = postsCol.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: 'id',
          as: 'users',
        },
      },
      {
        $sort: {
          createdAt: -1,
        },
      },
    ])

    const posts = (await postsCursor.toArray()).map(({ users, ...rest }) => ({
      ...rest,
      user: users[0],
    }))

    res.render('home', {
      user: req.user,
      posts,
      APP_CONFIG_JSON,
    })
  } else {
    res.render('signin', {
      APP_CONFIG_JSON,
    })
  }
})

router.get('/request-reset-password', (req, res) => {
  res.render('request-reset-password', {
    APP_CONFIG_JSON,
  })
})

// 비밀번호 초기화 진행
router.get('/reset-password', async (req, res) => {
  const { code } = req.query

  const users = await getUsersCollection()
  const user = await users.findOne({
    passwordResetCode: code,
  })

  // 초기화 진행중인 유저가 아니라면
  if (!user || !user.pendingPassword) {
    res.status(400).end()
    return
  }

  const { pendingPassword } = user

  // 비밀번호 초기화 진행
  await users.updateOne(
    {
      id: user.id,
    },
    {
      $set: {
        password: pendingPassword,
        pendingPassword: null,
      },
    }
  )

  redirectWithMsg({
    res,
    dest: '/',
    info: '비밀번호가 변경되었습니다. 해당 비밀번호로 로그인 해 주세요.',
  })
})

// 비밀번호 초기화 요청
router.post('/request-reset-password', async (req, res) => {
  if (!req.body) {
    res.status(400).end()
    return
  }

  const { email, password } = res.body
  const users = await getUsersCollection()

  // 입력된 이메일이나 비밀번호가 없다면
  if (!email || !password) {
    redirectWithMsg({
      res,
      dest: '/request-reset-password',
      error: '이메일과 비밀번호를 모두 입력해주세요.',
    })
    return
  }

  // DB에서 검색
  const existingUser = await users.findOne({
    email,
  })

  // 검색된 유저 정보가 없다면
  if (!existingUser) {
    redirectWithMsg({
      res,
      dest: '/request-reset-password',
      error: '존재하지 않는 이메일입니다.',
    })
    return
  }

  // 초기화 비밀번호 코드 생성
  const passwordResetCode = uuidv4()
  // 메일 송신
  await ses
    .sendEmail({
      Content: {
        Simple: {
          Subject: {
            Data: '비밀번호 초기화',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: `다음 링크를 눌러 비밀번호를 초기화 합니다. https://${HOST}/reset-password?code=${passwordResetCode}`,
              Charset: 'UTF-8',
            },
          },
        },
      },
      Destination: {
        ToAddresses: [email],
      },
      FromEmailAddress: 'noreply@',
    })
    .promise()

  // DB에 비밀번호 초기화 진행 중 표시
  await users.updateOne(
    {
      id: existingUser.id,
    },
    {
      $set: {
        pendingPassword: await encryptPassword(password),
        passwordResetCode,
      },
    }
  )

  redirectWithMsg({
    res,
    dest: '/',
    info: '비밀번호 초기화 요청이 전송되었습니다. 이메일을 확인해 주세요',
  })
})

router.get('/signup', (req, res) => {
  res.render('signup', {
    APP_CONFIG_JSON,
  })
})

// 로그인 시도
router.post('/signin', async (req, res) => {
  if (!req.body) {
    redirectWithMsg({
      res,
      dest: '/',
      error: '잘못된 요청입니다.',
    })
    return
  }

  const users = await getUsersCollection()
  const { email, password } = req.body

  // 입력된 이메일이나 비밀번호가 없다면
  if (!email || !password) {
    redirectWithMsg({
      res,
      dest: '/',
      error: '이메일과 비밀번호를 모두 입력해주세요.',
    })
    return
  }

  // DB 유저 검색
  const existingUser = await users.findOne({
    email,
  })

  // 검색된 유저가 없다면
  if (!existingUser) {
    redirectWithMsg({
      res,
      dest: '/',
      error: '이메일 혹은 비밀번호가 일치하지 않습니다.',
    })
    return
  }

  // 비밀번호 비교
  const isPasswordCorrect = await comparePassword(
    password,
    existingUser.password
  )

  // 비밀번호가 일치한다면
  if (isPasswordCorrect) {
    const token = await getAccessTokenForUserId(existingUser.id)
    setAccessTokenCookie(res, token)

    redirectWithMsg({
      res,
      dest: '/',
      info: '로그인 되었습니다.',
    })
  }
  // 그렇지 않을 경우
  else {
    redirectWithMsg({
      res,
      dest: '/',
      error: '이메일 혹은 비밀번호가 일치하지 않습니다.',
    })
  }
})

// 이메일 인증
router.get('/verify-email', async (req, res) => {
  const { code } = req.query
  if (!code) {
    res.status(400).end()
    return
  }

  const users = await getUsersCollection()

  // 이메일 인증이 진행중인 유저 검색
  const user = await users.findOne({
    emailVerificationCode: code,
  })

  // 검색된 유저가 없을 경우
  if (!user) {
    res.status(400).end()
    return
  }

  // 이메일 인증완료 업데이트
  await users.updateOne(
    {
      id: user.id,
    },
    {
      $set: {
        verified: true,
      },
    }
  )

  redirectWithMsg({
    res,
    dest: '/',
    info: '이메일이 인증되었습니다.',
  })
})

// 회원가입
router.post('/signup', async (req, res) => {
  const users = await getUsersCollection()
  const { email, password } = req.body

  // 입력된 이메일이나 비밀번호가 없다면
  if (!email || !password) {
    redirectWithMsg({
      dest: '/signup',
      error: '이메일과 비밀번호를 모두 입력해야 합니다.',
      res,
    })
    return
  }

  // DB 검색
  const existingUser = await users.findOne({
    email,
  })

  // 동일한 이메일의 유저가 있다면
  if (existingUser) {
    redirectWithMsg({
      dest: '/signup',
      error: '같은 이메일의 유저가 이미 존재합니다.',
      res,
    })
    return
  }

  const newUserId = uuidv4()
  const emaildVerificationCode = uuidv4()
  await ses
    .sendEmail({
      Content: {
        Simple: {
          Subject: {
            Data: '이메일 인증 요청',
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: `다음 링크를 눌러 이메일 인증을 진행해주세요. https://${HOST}/verify-email?code=${emaildVerificationCode}`,
              Charset: 'UTF-8',
            },
          },
        },
      },
      Destination: {
        ToAddresses: [email],
      },
      FromEmailAddress: 'noreply@',
    })
    .promise()

  await users.insertOne({
    id: newUserId,
    email,
    password: encryptPassword(password), // 암호화
    verified: true, // true 일 때 우리 앱에서 정상적인 활동이 가능
    emaildVerificationCode,
  })

  setAccessTokenCookie(res, await signJWT(newUserId))
  res.redirect('/')
})

router.get('/logout', (req, res) => {
  res.clearCookie('access_token')
  res.redirect('/')
})

module.exports = router
