httpx: CLI for http file
==============================

http file used by JetBrains IDE and VS Code REST Client for editor http client, and httpx is CLI to execute the http request in http file.

# Get started

### Install httpx

```
deno install -q -A --unstable -r -f -n httpx https://denopkg.com/linux-china/deno-httpx/cli.ts
```

### index.http

Create index.http file with following code:

```http request
### getInternetIp
GET https://httpbin.org/ip

> {%
    client.log("your ip: "+response.body['origin']);
%}
```

### Execute http target

Execute `httpx getInternetIp` on the terminal

![httpx cli](./docs/httpx-cli.png)

# References

* HTTP client in IntelliJ IDEA code editor: https://www.jetbrains.com/help/idea/http-client-in-product-code-editor.html
* VS Code REST Client extension: https://marketplace.visualstudio.com/items?itemName=humao.rest-client
