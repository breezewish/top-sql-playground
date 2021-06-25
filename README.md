# Top SQL Playground

## Getting Started

```shell
make ui
UI=1 make server
make run
```

This will by default start multiple gRPC service endpoints so that you can point multiple TiDB instances to them.

Note: This requires to have [Node.js](https://nodejs.org/en/) and [Yarn](https://classic.yarnpkg.com/en/docs/install#mac-stable) installed.

After starting the server, navigate to http://localhost:14000/

## Development

Start a server without UI:

```shell
make server
make run
```

Start a UI debug server which connects to the server:

```shell
cd ui
yarn start
```
