/* TODO:
 - Amount in tokens
 - Link to asset page
 - Format asset correctly
 - Cancel order (event)
 - Post order (requires WS orderbook subscription)
 * */

const Discord = require('discord.js')
const axios = require('axios')
const Web3 = require('web3')

const config = require('./config.json')
const exchangeABI = require('./WyvernExchange.json')

const web3 = new Web3(config.web3_provider)
const contract = new web3.eth.Contract(exchangeABI, config.exchange_address)
const hook = new Discord.WebhookClient(config.webhook_id, config.webhook_token)

const promisify = (inner) =>
  new Promise((resolve, reject) =>
    inner((err, res) => {
      if (err) { reject(err) }
      resolve(res)
    })
  )

const fetchOrder = async (hash) => {
  const order = await (async () => {
    const response = await axios.get(`${config.orderbook_url}/v1/orders/${hash}`)
    return response.data.result
  })().catch(() => {
    return null
  })
  return order
}

const hookOnMatch = async (event) => {
  const buy = await fetchOrder(event.returnValues.buyHash)
  const sell = await fetchOrder(event.returnValues.sellHash)
  const order = buy || sell
  const maker = order.maker
  const taker = order.taker
  hook.send(`**MATCH** - *${order.metadata.schema}* sold by [${maker}](${config.explorer_account_prefix + maker}) to [${taker}](${config.explorer_account_prefix + taker})\
  - [Order](${'https://exchange.projectwyvern.com/orders/' + order.hash}) - [TX](${config.explorer_tx_prefix + event.transactionHash})`)
}

const handleEvents = async (block) => {
  const matchEvents = await promisify(c => contract.getPastEvents('OrdersMatched', {fromBlock: block, toBlock: block}, c))
  await Promise.all(matchEvents.map(hookOnMatch))
}

var lastBlockNumber
const poll = async () => {
  const blockNumber = await promisify(web3.eth.getBlockNumber)
  if (lastBlockNumber !== blockNumber) {
    lastBlockNumber = blockNumber
    await handleEvents(blockNumber)
  }
}

setInterval(poll, 1000)
