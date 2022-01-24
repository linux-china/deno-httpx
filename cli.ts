import * as stdFs from "https://deno.land/std@0.122.0/fs/mod.ts";
import {Command} from "https://deno.land/x/cliffy@v0.20.1/command/command.ts";
import {findHttpTarget, parseTargets, runTarget} from "./mod.ts";

const httpFiles = ["index.http"]

function detectHttpFile(): string | undefined {
    return httpFiles.filter(file => {
        return stdFs.existsSync(file);
    })[0];
}

async function runHttpFile(httpFile: string, ...targets: Array<string>) {
    const target = targets ? targets[0] : "";
    const httpTarget = await findHttpTarget(httpFile, target);
    if (httpTarget) {
        runTarget(httpTarget);
    } else {
        taskfileNotFound(httpFile);
    }
}

function printTargets() {
    const taskfile = detectHttpFile();
    if (taskfile) {
        parseTargets(taskfile).then(targets => {
            for (const target of targets) {
                if (target.name) {
                    console.log(`${target.index}. ${target.name}: ${target.comment} - ${target.url}`)
                } else {
                    console.log(`${target.index}. ${target.comment} - ${target.url}`)
                }
            }
        })
    } else {
        taskfileNotFound(taskfile ?? "index.http");
    }
}


function printSummary() {
    const taskfile = detectHttpFile();
    if (taskfile) {
        parseTargets(taskfile).then(targets => {
            for (const target of targets) {
                if (target.comment) {
                    if (target.name) {
                        console.log(`${target.name} # ${target.comment}`)
                    } else {
                        console.log(`${target.index} # ${target.comment}`)
                    }
                } else {
                    if (target.name) {
                        console.log(`${target.name}`)
                    } else {
                        console.log(`${target.index}`)
                    }
                }
            }
        })
    } else {
        taskfileNotFound(taskfile ?? "index.http");
    }
}

function printGlobals() {
    for (const entry of Object.entries(localStorage)) {
        console.log(`${entry[0]}: ${entry[1]}`);
    }
}

async function generateShellCompletion(shell: string) {
    if (shell === "zsh") {
        console.log("#compdef dx\n" +
            "#autload\n" +
            "\n" +
            "local subcmds=()\n" +
            "\n" +
            "while read -r line ; do\n" +
            "   if [[ ! $line == Available* ]] ;\n" +
            "   then\n" +
            "      subcmds+=(${line/[[:space:]]*\\#/:})\n" +
            "   fi\n" +
            "done < <(dx --summary)\n" +
            "\n" +
            "_describe 'command' subcmds")
    } else {
        console.log("Not available now for  ", shell);
    }
}

function taskfileNotFound(httpFile: string) {
    console.log(`Failed to find '${httpFile}' `);
    Deno.exit(2);
}

const command = new Command()
    .name("httpx")
    .version("0.1.0")
    .versionOption("-v, --version")
    .description("A tool to execute http file")
    .option("--summary", "List names of available targets in http file", {
        standalone: true,
        action: () => {
            printSummary();
        }
    })
    .option("-t, --targets", "List targets in index.http", {
        standalone: true,
        action: () => {
            printTargets();
        }
    })
    .option("-g, --globals", "List global key-values", {
        standalone: true,
        action: () => {
            printGlobals();
        }
    })
    .option("-u, --upgrade", "Upgrade httpx to last version", {
        standalone: true,
        action: async () => {
            console.log("Begin to upgrade httpx to last version.")
            const p = Deno.run({
                cmd: "deno install -q -A --unstable -r -f -n dx https://denopkg.com/linux-china/httpx/cli.ts".split(" ")
            });
            await p.status();
            p.close();
        }
    })
    .option("-c, --completion <shell:string>", "Generate shell completion for zsh, zsh.", {
        standalone: true,
        action: async (options: any) => {
            await generateShellCompletion(options.completion);
        }
    })
    .option("-e, --env <env:string>", "env name in http-client.env.json")
    .arguments("[script:string] [args...:string]")
    .action(async (options: any, script: string | undefined, args: string[] | undefined) => {
        // set http client env
        const env = options['env'];
        if (env) {
            Deno.env.set("HTTP_CLIENT_ENV", env);
        }
        if (typeof script === 'undefined') {
            const httpFile = detectHttpFile();
            if (httpFile) {
                await runHttpFile(httpFile);
            } else { // display help
                await command.parse(["-h"])
            }
        } else {
            //run http file
            if (script.endsWith(".http")) {
                if (script.endsWith("index.http")) {
                    await runHttpFile(script, ...(args ?? []));
                } else {
                    await runHttpFile(script);
                }
            } else { // run targets
                const httpFile = detectHttpFile();
                if (httpFile) {
                    //script is task name now
                    const targets = args ? [script, ...args] : [script];
                    await runHttpFile(httpFile, ...targets);
                } else {
                    taskfileNotFound("index.http");
                }
            }
        }
    });

if (import.meta.main) {
    await command.parse(Deno.args);
}
