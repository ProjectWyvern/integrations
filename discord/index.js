/* TODO:
 - Correct taker on order match
 - Link to asset page
 - Cancel order (event)
 * */

const Discord = require('discord.js')
const Web3 = require('web3')
const BigNumber = require('bignumber.js')

const { WyvernProtocol } = require('wyvern-js')
const { WyvernExchange } = require('wyvern-exchange')
var { tokens, schemas } = require('wyvern-schemas')

const config = require('./config.json')
const exchangeABI = require('./WyvernExchange.json')

tokens = tokens[config.network]
tokens = [].concat(tokens.canonicalWrappedEther, ...tokens.otherTokens)
schemas = schemas[config.network]

const wyvernExchange = new WyvernExchange(config.orderbook_url)
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
    const response = await wyvernExchange.order(hash)
    return response
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
  const token = tokens.filter(t => t.address.toLowerCase() === order.paymentToken.toLowerCase())[0]
  const amount = WyvernProtocol.toUnitAmount(new BigNumber(order.basePrice), token.decimals)
  const schema = schemas.filter(s => s.name === order.metadata.schema)[0]
  const title = schema.formatter(order.metadata.nft).title
  hook.send(`**MATCH** - ${title} sold by [${maker}](${config.explorer_account_prefix + maker}) to [${taker}](${config.explorer_account_prefix + taker})\
  for ${amount} ${token.symbol} - [Order](${'https://exchange.projectwyvern.com/orders/' + order.hash}) - [TX](${config.explorer_tx_prefix + event.transactionHash})`)
}

const hookOnPost = async (order) => {
  const maker = order.maker
  const token = tokens.filter(t => t.address.toLowerCase() === order.paymentToken.toLowerCase())[0]
  const amount = WyvernProtocol.toUnitAmount(new BigNumber(order.basePrice), token.decimals)
  const schema = schemas.filter(s => s.name === order.metadata.schema)[0]
  const title = schema.formatter(order.metadata.nft).title
  const which = order.side === 0 ? 'purchase' : 'sale'
  hook.send(`**POST** - ${title} for ${which} by [${maker}](${config.explorer_account_prefix + maker}) for ${amount} ${token.symbol} - [Order](${'https://exchange.projectwyvern.com/orders/' + order.hash})`)
}

const handleEvents = async (block) => {
  const matchEvents = await promisify(c => contract.getPastEvents('OrdersMatched', {fromBlock: block, toBlock: block}, c))
  await Promise.all(matchEvents.map(hookOnMatch))
}

var first = false
var lastBlockNumber
var hashes = []
const poll = async () => {
  const blockNumber = await promisify(web3.eth.getBlockNumber)
  const orders = await wyvernExchange.orders()
  await Promise.all(orders.map(async order => {
    if (first && hashes.indexOf(order.hash) === -1) {
      return hookOnPost(order)
    }
    return null
  }))
  hashes = orders.map(o => o.hash)
  first = true
  if (lastBlockNumber !== blockNumber) {
    lastBlockNumber = blockNumber
    await handleEvents(blockNumber)
  }
}

setInterval(poll, 1500)
