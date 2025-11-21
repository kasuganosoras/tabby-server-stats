const path = require('path');

module.exports = {
  target: 'node',
  mode: 'production',
  context: __dirname,
  devtool: 'source-map',
  entry: {
    index: './src/index.ts',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    libraryTarget: 'umd',
    globalObject: 'this',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.json'),
            },
          },
        ],
        exclude: path.resolve(__dirname, 'node_modules'),
      },
      {
        test: /\.svg$/,
        type: 'asset/source',
      },
      {
        test: /\.scss$/,
        use: ['to-string-loader', 'css-loader', 'sass-loader'],
      }
    ],
  },
  externals: [
    /^@angular/,
    /^rxjs/,
    /^tabby-/,
    'electron',
    'fs',
    'path',
    'os'
  ]
};