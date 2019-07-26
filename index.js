const url = require("url");
const path = require("path");
const child_process = require("child_process");

const gitRepoInfo = require("git-repo-info");
const gitUrlParse = require("git-url-parse");

// determine what vcs does the repo use
const supportedVcs = [
    {
        name: "git",
        getRoot() {
            const repoInfo = gitRepoInfo();
            return repoInfo.root ? repoInfo.root : false;
        }
    },
    {
        name: "mercurial",
        getRoot() {
            try {
                return path.resolve(
                    child_process.execFileSync("hg", ["root"], {
                        encoding: "utf8"
                    })
                );
            } catch (error) {
                return false;
            }
        }
    },
    {
        name: "subversion",
        getRoot() {
            // unimplemented
            return false;
        }
    }
];

const getUrlGenerator = ({ vcs, service, remote = "origin", https = true }) => {
    const urlElement = {};
    let getRepoRelFilePath;

    const generatePath = {
        github: ({ urlElement, filePath }) => {
            const baseUrl = `${urlElement.protocol}://${urlElement.host}`;
            const proc = tag => {
                const urlPath = encodeURI(
                    url.format(
                        path.join(
                            "/",
                            urlElement.pathToRepo,
                            tag,
                            urlElement.branch,
                            filePath
                        )
                    )
                );
                return baseUrl + urlPath;
            };
            return {
                view: proc("blob"),
                raw: proc("raw"),
                edit: proc("edit"),
                blame: proc("blame"),
                history: proc("commits")
            };
        },
        gitlab: function(obj) {
            return this.github(obj);
        },
        bitbucket: ({ urlElement, filePath }) => {
            const baseUrl = `${urlElement.protocol}://${urlElement.host}`;
            const proc = tag => {
                const urlPath = encodeURI(
                    url.format(
                        path.join(
                            "/",
                            urlElement.pathToRepo,
                            tag,
                            urlElement.branch,
                            filePath
                        )
                    )
                );
                return baseUrl + urlPath;
            };
            return {
                view: proc("src"),
                raw: proc("raw"),
                edit: proc("src") + "?mode=edit&spa=0",
                blame: proc("annotate"),
                history: proc("history-node")
            };
        }
    };

    const detectService = urlInfo => {
        if (urlInfo.source === "github.com") {
            return "github";
        } else if (urlInfo.source === "gitlab.com") {
            return "gitlab";
        } else if (urlInfo.source === "bitbucket.org") {
            return "bitbucket";
        } else {
            const subdomain = urlInfo.resource.match(/^(\w+)\./);
            if (subdomain && subdomain[1] in generatePath) {
                return subdomain[1];
            } else {
                return "gitlab";
            }
        }
    };

    urlElement.protocol = https ? "https" : "http";
    if (vcs === "git") {
        const rawUrl = child_process
            .execFileSync("git", ["config", "--get", `remote.${remote}.url`], {
                encoding: "utf8"
            })
            .trim();
        const urlInfo = gitUrlParse(rawUrl);
        if (!service) {
            service = detectService(urlInfo);
        }

        urlElement.host =
            urlInfo.resource +
            (urlInfo.port !== null ? `:${urlInfo.port}` : "");
        urlElement.pathToRepo = urlInfo.full_name;
        urlElement.branch = child_process
            .execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
                encoding: "utf8"
            })
            .trim();
        getRepoRelFilePath = absPath => {
            return (
                child_process
                    .spawnSync(
                        "git",
                        [
                            "ls-tree",
                            "--full-name",
                            "--name-only",
                            "HEAD",
                            absPath
                        ],
                        { encoding: "utf8" }
                    )
                    .stdout.trim() || null
            );
        };
    }

    return absoluteFilePath => {
        const repoRelFilePath = getRepoRelFilePath(absoluteFilePath);
        return repoRelFilePath
            ? generatePath[service]({ urlElement, filePath: repoRelFilePath })
            : null;
    };
};

module.exports = (option, _ctx) => {
    /*
     *  determine vcs type and repository root directory.
     */
    const opt = (vcs => {
        let repoRoot;
        if (vcs) {
            const vcsUtil = supportedVcs.find(v => {
                return v.name === vcs;
            });
            if (vcsUtil) {
                repoRoot = vcsUtil.getRoot();
            } else {
                vcs = undefined;
                repoRoot = false;
            }
        } else {
            for (const vcsEntry of supportedVcs) {
                repoRoot = vcsEntry.getRoot();
                if (repoRoot) {
                    vcs = vcsEntry.name;
                    break;
                }
            }
        }
        return {
            repoRootDir: repoRoot || undefined,
            vcs: vcs
        };
    })(option.vcs);

    const genUrl = getUrlGenerator({
        repoRootDir: opt.repoRootDir,
        vcs: opt.vcs,
        service: option.service,
        remote: option.remote,
        https: option.https
    });

    return {
        name: "vuepress-plugin-remote-url",
        extendPageData(page) {
            page.remoteUrl = genUrl(page._filePath);
        }
    };
};
