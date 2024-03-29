/// <reference lib="esnext" />
// deno-lint-ignore-file no-explicit-any

import {readLines, StringReader} from "https://deno.land/std@0.122.0/io/mod.ts";
import {HttpClient, HttpResponse} from "./http-client.ts";
import {assertEquals} from "https://deno.land/std@0.122.0/testing/asserts.ts";
import * as base64 from "https://deno.land/std@0.122.0/encoding/base64.ts";

const LINE_TERMINATOR = "\r\n";
const textEncoder = new TextEncoder();

const httpClientEnvFile = "http-client.env.json";
const httpClientPrivateEnvFile = "http-client.private.env.json";

export class HttpTarget {
    index: number
    name?: string
    comment?: string
    tags?: string[]
    method: string
    url: string
    schema: string
    headers?: Headers
    body?: Blob | BufferSource | FormData | URLSearchParams | ReadableStream<Uint8Array> | string
    script?: string

    constructor(method: string, url: string, index: number) {
        this.method = method;
        this.url = url;
        this.index = index;
        this.schema = "HTTP/1.1"
    }

    addTag(tag: string) {
        if (!this.tags) {
            this.tags = [];
        }
        this.tags.push(tag);
    }

    addHeader(name: string, value: string) {
        if (!this.headers) {
            this.headers = new Headers();
        }
        this.headers.set(name, value);
    }

    addScriptLine(line: string) {
        this.script = this.script + LINE_TERMINATOR + line;
    }

    addBodyLine(line: string) {
        if (!this.body) {
            this.body = line;
        } else {
            this.body = this.body + LINE_TERMINATOR + line;
        }
    }

    isEmpty(): boolean {
        return this.method === "" && this.url === "";
    }

    isMatch(word: string): boolean {
        if (this.name && this.name === word) {
            return true;
        }
        if (this.comment && this.comment.indexOf(word) >= 0) {
            return true;
        }
        return this.url.indexOf(word) >= 0;
    }

    cleanBody() {
        if (typeof this.body === "string") {
            if (this.body && this.body.endsWith(LINE_TERMINATOR)) {
                this.body = this.body.substring(0, this.body.length - 2)
            }
        }
    }

    prepareBody() {
        if (!(this.url.startsWith("http://") || this.url.startsWith("https://"))) {
            const httpSchema = this.schema.substring(0, this.schema.indexOf("/")).toLocaleLowerCase() + "://";
            this.url = httpSchema + this.headers?.get("Host") + this.url;
        }
        if (typeof this.body === "string") {
            // load body from file
            if (this.body.startsWith("< ")) { // import content from file
                this.body = Deno.readFileSync(this.body.substring(2).trim());
            }
        }
        if (this.script && this.script.startsWith("> ")) {
            this.script = Deno.readTextFileSync(this.script.substring(2).trim());
        }
        // basic Authorization conversation
        if (this.headers != null) {
            const authorization = this.headers.get("Authorization");
            if (authorization && authorization.startsWith("Basic ")) {
                const usernameAndPassword = authorization.substring(6).trim();
                if (usernameAndPassword.indexOf(" ") > 0) {
                    const parts = usernameAndPassword.split(" ", 2);
                    const encodedText = base64.encode(parts[0] + ":" + parts[1].trim());
                    this.headers.set("Authorization", "Basic " + encodedText);
                }
            }
        }
    }
}


export function runTarget(target: HttpTarget) {
    target.prepareBody(); // prepare the body
    let env = Deno.env.get("HTTP_CLIENT_ENV");
    if (env) {
        env = " -- " + env;
    }
    if (target.comment || env) {
        console.log(`### ${target.comment ?? ""} ${env ?? ""}`)
    }
    console.log(`${target.method} ${target.url}`);
    if (target.headers) {
        target.headers.forEach((value, key) => {
            console.log(`${key}: ${value}`);
        })
    }
    const scriptContext: { [name: string]: any } = {}
    fetch(target.url, {
        method: target.method, // or 'PUT'
        headers: target.headers,
        body: target.body
    }).then(res => {
        console.log("\r\n=========Response=============")
        console.log(`${target.schema} ${res.status} ${res.ok ? 'OK' : 'ERROR'}`);
        res.headers.forEach((value, key) => {
            console.log(`${key}: ${value}`);
        })
        let body: Promise<any | string | ArrayBuffer> | null = null;
        const contentType = res.headers.get("content-type");
        if (contentType) {
            if (contentType.startsWith("text/")) {
                body = res.text();
            } else if (contentType.indexOf("json")) {
                body = res.json();
            }
        }
        if (!body) {
            body = res.arrayBuffer();
        }
        if (target.script) {
            scriptContext['client'] = buildHttpClient(target);
            scriptContext['response'] = buildHttpResponse(res);
        }
        return body;
    }).then(body => {
        console.log("");
        if (target.script) {
            scriptContext['response'].body = body;
        }
        if (typeof body === 'string') {
            console.log(body);
        } else if (typeof body === 'object') {
            // json reformat
            console.log(JSON.stringify(body, null, 2));
        } else {
            console.log(new Uint8Array(body));
        }
        return body;
    }).then(_body => {
        if (target.script) {
            console.log("=============Tests==============")
            const javaScriptCode = "export default function validate(client,response) {" + target.script + "};";
            import("data:application/javascript;charset=utf-8;base64," + base64.encode(textEncoder.encode(javaScriptCode)))
                .then(module => {
                    module['default'](scriptContext['client'], scriptContext['response'])
                });
        }
    }).catch(error => console.error(error))
}

export async function parseTargets(filePath: string): Promise<HttpTarget[]> {
    const cleanContent = await getCleanHttpFile(filePath);
    const targets: HttpTarget[] = [];
    let index = 1;
    let httpTarget = new HttpTarget("", "", index);
    for await (const l of readLines(new StringReader(cleanContent))) {
        const line = l.trimEnd() as string;
        if ((line === "" || line.startsWith("#!/usr/bin/env")) && httpTarget.isEmpty()) { // ignore empty line or shebang before http target

        } else if (line.startsWith("###")) { // separator
            const comment = line.substring(3).trim();
            if (httpTarget.isEmpty()) {
                httpTarget.comment = comment;
            } else {
                httpTarget.cleanBody();
                targets.push(httpTarget);
                index = index + 1;
                httpTarget = new HttpTarget("", "", index);
                httpTarget.comment = comment;
            }
        } else if (line.startsWith("//") || line.startsWith("#")) { //comment
            if (line.indexOf("@") >= 0) {
                const tag = line.substring(line.indexOf("@") + 1);
                const parts = tag.split(/[=\s]/, 2);
                if (parts[0] === "name") {
                    httpTarget.name = parts[1];
                }
                httpTarget.addTag(tag);
            } else if (!httpTarget.comment) {
                httpTarget.comment = line.substring(2).trim();
            }
        } else if ((line.startsWith("GET ") || line.startsWith("POST ") || line.startsWith("PUT ") || line.startsWith("DELETE "))
            && httpTarget.method === "") { // HTTP method & URL
            const parts = line.split(" ", 3); // format as 'POST URL HTTP/1.1'
            httpTarget.method = parts[0];
            httpTarget.url = parts[1].trim();
            if (parts.length > 2) {
                httpTarget.schema = parts[2];
            }
        } else if (line.startsWith("  ")
            && (line.indexOf("  /") >= 0 || line.indexOf("  ?") >= 0 || line.indexOf("  &") >= 0)
            && httpTarget.headers === undefined) { // long request url into several lines
            httpTarget.url = httpTarget.url + line.trim();
        } else if (line.indexOf(":") > 0 && httpTarget.body === undefined && httpTarget.script === undefined) { // http headers
            const parts = line.split(":", 2);
            httpTarget.addHeader(parts[0].trim(), parts[1].trim());
        } else if (line.startsWith("<> ")) { //response-ref

        } else {
            if (!(line === "" && httpTarget.body === undefined)) {
                if (line.startsWith("> {%")) { // indicate script
                    let code = line.substring("> {%".length).trim();
                    if (code.endsWith("%}")) {
                        code = code.substring(0, code.length - 2);
                    }
                    httpTarget.script = code;
                } else if (line.startsWith("%}")) { // end of script

                } else if (line.startsWith("> ")) { // insert the script file
                    httpTarget.script = line;
                } else {
                    if (httpTarget.script !== undefined) { //add script line
                        httpTarget.addScriptLine(l);
                    } else { // add body line
                        httpTarget.addBodyLine(l);
                    }
                }
            }
        }
    }
    if (!httpTarget.isEmpty()) {
        httpTarget.cleanBody();
        targets.push(httpTarget)
    }
    return targets;
}

export async function findHttpTarget(httpFile: string, word?: string): Promise<HttpTarget | null> {
    const targets = await parseTargets(httpFile);
    if (word === undefined || word === "") {
        return targets[0];
    }
    // find by @name exactly
    for (const target of targets) {
        if (target.name && target.name === word) {
            return target;
        }
    }
    // wild match by comment and url
    for (const target of targets) {
        if (target.isMatch(word)) {
            return target;
        }
    }
    return null;
}


/**
 * replace variables with context
 * @param text text content
 * @param context context
 */
function replaceVariables(text: string, context: { [name: string]: string }): string {
    let newText = text;
    while (newText.indexOf("{{") >= 0) {
        const start = newText.indexOf("{{");
        const end = newText.indexOf("}}");
        if (end < start) {
            return newText;
        }
        const name = newText.substring(start + 2, end).trim();
        let value = context[name];
        if (!value) {
            value = localStorage.getItem(name) ?? "";
        }
        newText = newText.substring(0, start) + value + newText.substring(end + 2);
    }
    return newText;
}

/**
 * get clean http file with variables replaced
 * @param httpFile http file name
 */
async function getCleanHttpFile(httpFile: string): Promise<string> {
    let env = Deno.env.get("HTTP_CLIENT_ENV");
    const context: { [name: string]: any } = {}
    context["$uuid"] = crypto.randomUUID();
    context["$timestamp"] = Date.now();
    context["$randomInt"] = Math.floor(Math.random() * 1001);
    // load http-client.env.json
    if (existsSync(httpClientEnvFile)) {
        const fileText = Deno.readTextFileSync(httpClientEnvFile);
        const json: any = JSON.parse(fileText);
        const keys = Object.keys(json);
        if (keys.length > 1) {
            if (env && json[env]) {
                Object.assign(context, json[env]);
            }
        } else if (keys.length == 1 && env === undefined) {
            env = keys[0];
            Object.assign(context, json[env]);
        }
    }
    // load http-client.private.env.json
    if (existsSync(httpClientPrivateEnvFile) && env !== undefined) {
        const fileText = Deno.readTextFileSync(httpClientPrivateEnvFile);
        const json: any = JSON.parse(fileText);
        if (json[env]) {
            Object.assign(context, json[env]);
        }
    }
    const fileContent = await Deno.readTextFile(httpFile);
    return replaceVariables(fileContent, context);
}

function buildHttpClient(_httpTarget: HttpTarget): HttpClient {
    return {
        global: {
            clear(varName: string): void {
                localStorage.removeItem(varName);
            }, clearAll(): void {
                localStorage.clear();
            }, get(varName: string): string {
                return localStorage.getItem(varName) ?? "";
            }, isEmpty(): boolean {
                return localStorage.length == 0;
            }, set(varName: string, varValue: string): void {
                localStorage.setItem(varName, varValue)
            }
        },
        test(testName: string, func: () => void) {
            console.log(`===========test: ${testName}================`);
            func();
        }, assert(condition: boolean, message?: string): void {
            assertEquals(condition, true, message);
        }, log(text: string): void {
            console.log(text);
        }
    }
}

function buildHttpResponse(res: Response): HttpResponse {
    return {
        body: "",
        contentType: {
            mimeType: "",
            charset: "utf-8"
        },
        headers: {
            valueOf(headerName: string): string | null {
                return res.headers.get(headerName);
            }, valuesOf(headerName: string): string[] {
                const values: string[] = [];
                const value = res.headers.get(headerName);
                if (value) {
                    values.push(value);
                }
                return values;
            }
        },
        status: res.status
    };
}

function existsSync(filePath: string): boolean {
    try {
        Deno.lstatSync(filePath);
        return true;
    } catch (_err: unknown) {
        return false
    }
}
