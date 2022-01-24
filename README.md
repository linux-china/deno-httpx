httpx: CLI for http file
==============================

http file used by JetBrains IDE and VS Code REST Client for editor http client, and httpx is CLI to execute the http request in http file.

# Features

* Execute requests in http file
* Javascript validation support: ECMAScript 5.1 by JetBrains, esnext support by httpx

# Get started

### Install httpx

```
deno install -q --location https://deno.land/x/httpx --allow-net --allow-read --allow-env --unstable -r -f -n httpx https://deno.land/x/httpx/cli.ts
```

### index.http file

Create 'index.http' file with following code:

```
### get my internet ip
# @name myip
GET https://httpbin.org/ip

> {%
    client.log("your ip: " + response.body['origin']);
%}
```

### Execute http target

Execute `httpx index.http myip` on the terminal.

![httpx cli](./docs/httpx-cli.png)

# oh-my-zsh integration for shell completion

Please create `~/.oh-my-zsh/custom/plugins/httpx` with following code, and add `httpx` to `plugins` in `.zshrc` file.

```shell
#compdef index.http
#autload

local subcmds=()

while read -r line ; do
   if [[ ! $line == Available* ]] ;
   then
      subcmds+=(${line/[[:space:]]*\#/:})
   fi
done < <(httpx --summary)

_describe 'command' subcmds
```

Add shebang for index.http and execute `chmod u+x index.http`

```http request
#!/usr/bin/env httpx

### get my internet ip
# @name myip
GET https://httpbin.org/ip

```

Then execute `./index.http ` and press Tab for code completion.

# References

* HTTP Request in Editor Specification: https://github.com/JetBrains/http-request-in-editor-spec/blob/master/spec.md
* HTTP client in IntelliJ IDEA code editor: https://www.jetbrains.com/help/idea/http-client-in-product-code-editor.html
* VS Code REST Client extension: https://marketplace.visualstudio.com/items?itemName=humao.rest-client
