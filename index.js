const request = require('request')
const AWS = require('aws-sdk')
const S3 = new AWS.S3()
const util = require('util')

const STRIDE_CLIENT_ID = process.env.STRIDE_CLIENT_ID
const STRIDE_CLIENT_SECRET = process.env.STRIDE_CLIENT_SECRET

const S3_BUCKET = process.env.S3_BUCKET

const APP_URL = process.env.APP_URL

let cloudIds = {}

const loading = Promise.defer()
const loaded = loading.promise

loadChannels((err, data) => {
  try {
    if (err) {
      throw err
    }
    cloudIds = JSON.parse(data.Body.toString())
  }
  catch (e) {
    cloudIds = {}
  }
  finally {
    loading.resolve()
  }
})

function getAccessToken(callback) {
  const options = {
    uri: 'https://auth.atlassian.com/oauth/token',
    method: 'POST',
    json: {
      grant_type: "client_credentials",
      client_id: STRIDE_CLIENT_ID,
      client_secret: STRIDE_CLIENT_SECRET,
      "audience": "api.atlassian.com"
    }
  };
  request(options, function (err, response, body) {
    if (response.statusCode === 200 && body.access_token) {
      callback(null, body.access_token);
    } else {
      callback("could not generate access token: " + JSON.stringify(response));
    }
  })
}

function sendMessage(cloudId, conversationId, build, callback) {
  getAccessToken(function (err, accessToken) {
    if (err) {
      callback(err);
    } else {
      const uri = 'https://api.atlassian.com/site/' + cloudId + '/conversation/' + conversationId + '/message';
      const options = {
        uri: uri,
        method: 'POST',
        headers: {
          authorization: "Bearer " + accessToken,
          "cache-control": "no-cache"
        },
        json: {
          body: {
            version: 1,
            type: "doc",
            content: [
              {
                "type": "applicationCard",
                "attrs": {
                  "text": util.format('Travis CI build #%s %s', build.number, build.result_message),
                  "link": {
                    "url": build.build_url
                  },
                  "collapsible": true,
                  "title": {
                    "text": util.format('Travis CI build #%s %s', build.number, build.result_message),
                    "user": {
                      "icon": {
                        "url": "https://www.gravatar.com/avatar/c3c9338e575a73892b0f1257eb9ee997",
                        "label": "Travis-CI"
                      }
                    }
                  },
                  "description": {
                    "text": build.message
                  },
                  "details": [
                    {
                      "icon": {
                        "url": "https://image.ibb.co/fUViW5/board.png",
                        "label": "Issue type"
                      },
                      "text": "Story"
                    },
                    {
                      "badge": {
                        "value": 101,
                        "max": 99,
                        "appearance": "important"
                      }
                    },
                    {
                      "lozenge": {
                        "text": "Nearly Complete",
                        "appearance": "inprogress"
                      }
                    },
                    {
                      "title": "Watchers",
                      "users": [
                        {
                          "icon": {
                            "url": "https://www.gravatar.com/avatar/5db869c9686a1d191f99fc153c4d118c.jpg",
                            "label": "Kitty"
                          }
                        },
                        {
                          "icon": {
                            "url": "https://www.gravatar.com/avatar/440f0328de63d671bf337779b4eece44.jpg",
                            "label": "Puppy"
                          }
                        }
                      ]
                    }
                  ],
                  "context": {
                    "text": "Stride Documentation / ... / Nodes",
                    "icon": {
                      "url": "https://image.ibb.co/fPPAB5/Stride_White_On_Blue.png",
                      "label": "stride"
                    }
                  }
                }
              }
            ]
          }
        }
      }

      request(options, function (err, response, body) {
        callback(err, body);
      });
    }
  });
}

exports.travis_ci_event = (event, context, callback) => {
    const payload = JSON.parse(event.body).payload

    let finished = Object.keys(cloudIds).length

    const sent = []

    if (finished < 1) {
        return callback(null, {
            "statusCode": 200,
            "body": JSON.stringify({
                "sent": sent
            }),
            "isBase64Encoded": false
        })
    }

    function cb (err, body) {
        if (err) {
            return callback(err)
        }

        sent.push(body)

        if (--finished < 1) {
            return callback(null, {
                "statusCode": 200,
                "body": JSON.stringify({
                    "sent": sent
                }),
                "isBase64Encoded": false
            })
        }
    }

    for (var k in cloudIds) {
        let channel = cloudIds[k]
        console.log(channel)
        sendMessage(channel.cloudId, channel.conversationId, payload, cb)
    }
}

exports.stride_descriptor = (event, context, callback) => {
    return callback(null, {
        "statusCode": 200,
        "body": JSON.stringify({
          "baseUrl": APP_URL,
          "key": "Travis-CI-Stride",
          "lifecycle": {
            "installed": "/installed",
            "uninstalled": "/uninstalled"
          },
          "modules": {}
        }),
        "isBase64Encoded": false
    })
}

function loadChannels(callback) {
  let buff = new Buffer(JSON.stringify(cloudIds))

  return S3.getObject({
    Bucket: S3_BUCKET,
    Key: 'channels.json'
  }, (err, data) => {
    return callback(err, data)
  })
}

function saveChannels(callback) {
  let buff = new Buffer(JSON.stringify(cloudIds))

  S3.putObject({
    Bucket: S3_BUCKET,
    Key: 'channels.json',
    Body: buff
  }, (err, data) => {
    return callback(err, data)
  })
}

exports.stride_install = (event, context, callback) => {
    const body = JSON.parse(event.body)
    if (body.cloudId && body.resourceType == 'conversation') {
        cloudIds[body.cloudId+body.resourceId] = { cloudId: body.cloudId, conversationId: body.resourceId }
    }
    console.log(event)

    return saveChannels((err, data) => {
      return callback(err, {
          "statusCode": 200,
          "body": JSON.stringify({
              "cloudIds": cloudIds
          }),
          "isBase64Encoded": false
      })
    })
}

exports.stride_uninstall = (event, context, callback) => {
    const body = JSON.parse(event.body)

    if (body.cloudId && body.resourceType == 'conversation') {
        delete cloudIds[body.cloudId+body.resourceId]
    }

    return saveChannels((err, data) => {
      return callback(err, {
          "statusCode": 200,
          "body": JSON.stringify({
              "cloudIds": cloudIds
          }),
          "isBase64Encoded": false
      })
    })
}

exports.router = (event, context, callback) => {
  return loaded
  .then(() => {
    console.log(event.path)
    switch (event.path) {
      case '/stride/descriptor':
        return exports.stride_descriptor(event, context, callback)
      case '/stride/installed':
        return exports.stride_install(event, context, callback)
      case '/stride/uninstalled':
        return exports.stride_uninstall(event, context, callback)
      case '/travis/event':
        return exports.travis_ci_event(event, context, callback)
      default:
        callback(null, {
            "statusCode": 404,
            "isBase64Encoded": false
        })
    }
  })
}
