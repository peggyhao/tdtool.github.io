/**
 * @Author: Zhengfeng.Yao <yzf>
 * @Date:   2017-05-10 10:17:24
 * @Last modified by:   yzf
 * @Last modified time: 2017-05-10 10:18:29
 */

import fs from 'fs'
import path from 'path'
import webpack from 'webpack'
import Browsersync from 'browser-sync'
import webpackDevMiddleware from 'webpack-dev-middleware'
import webpackHotMiddleware from 'webpack-hot-middleware'
import WriteFilePlugin from 'write-file-webpack-plugin'

import is from '../util/is'
import logger from '../util/logger'
import runNodeServer from '../util/runNodeServer'
import WebpackDevServer from '../util/webpackDevServer'
import happypackLoader from '../util/happyloader';

module.exports = async function start(options) {
  let configs = options.config.split(',')
  let serverCount = 0;
  const wbpcs = configs.map(item => {
    const configPath = path.resolve(process.cwd(), item)
    if (!fs.existsSync(configPath)) {
      logger.fatal(`Config file ${configPath} does not exist.`)
    }
    const config = require(configPath)
    if (is.Array(config)) {
      config.forEach(item => {
        if (item.devServer) {
          serverCount++
        }
      })
    } else {
      if (config.devServer) {
        serverCount++
      }
    }
    return config
  }).reduce((result, item) => {
    if (is.Array(item)) {
      return result.concat(item)
    }
    result.push(item)
    return result
  }, [])
  if (serverCount > 1) {
    logger.fatal(`Only one server support. Server count: ${serverCount}`)
  }
  const sConfig = wbpcs.find(item => !!item.devServer)
  if (sConfig.target !== 'node') {
    const server = new WebpackDevServer(wbpcs, options.port, options.host, !options.unJshappy);
    await server.run()
  } else {
    sConfig.plugins.push(new WriteFilePlugin({log: false}))
    await new Promise(resolve => {
      // 为client端增加热加载模块
      wbpcs.filter(x => x.target !== 'node').forEach(config => {
        if (is.Array(config.entry)) {
          config.entry.unshift('react-hot-loader/patch', 'webpack-hot-middleware/client')
        } else if (is.Object(config.entry)) {
          Object.keys(config.entry).forEach(key => {
            if (is.Array(config.entry[key])) {
              config.entry[key].unshift('react-hot-loader/patch', 'webpack-hot-middleware/client')
            } else {
              config.entry[key] = ['react-hot-loader/patch', 'webpack-hot-middleware/client', config.entry[key]]
            }
          })
        } else {
          config.entry = ['react-hot-loader/patch', 'webpack-hot-middleware/client', config.entry]
        }

        config.plugins.push(new webpack.HotModuleReplacementPlugin())
        let babelLoader = config.module.rules.find(x => x.loader === 'babel-loader')
        if (babelLoader && babelLoader.query) {
          babelLoader.query.plugins = ['react-hot-loader/babel'].concat(babelLoader.query.plugins || [])
        }
        if (!options.unJshappy && babelLoader) { // 多线程打包
          happypackLoader(config, babelLoader, 'jsHappy');
        }
      })

      const bundler = webpack(wbpcs)
      let wpMiddlewares = []
      let hotMiddlewares = []
      wbpcs.forEach((config, i) => {
        if (config.target !== 'node') {
          wpMiddlewares.push(webpackDevMiddleware(bundler, {
            publicPath: config.output.publicPath,
            stats: config.stats
          }))
          hotMiddlewares.push(webpackHotMiddleware(bundler.compilers[i]))
        }
      })

      let handleServerBundleComplete = async () => {
        handleServerBundleComplete = stats => !stats.stats[1].compilation.errors.length && runNodeServer(sConfig)

        const server = await runNodeServer(sConfig)
        const bs = Browsersync.create()
        bs.init({
          ghostMode: false,
          proxy: {
            target: server.host,
            middleware: [...wpMiddlewares, ...hotMiddlewares],
            proxyOptions: {
              xfwd: true
            }
          }
        }, resolve)
      }

      bundler.plugin('done', stats => handleServerBundleComplete(stats))
    })
  }
}
