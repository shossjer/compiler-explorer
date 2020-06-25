const _ = require('underscore');
const fs = require('fs');
const path = require('path');
const props = require('../properties.js');

function getFileinfo(projectid, config, target, fileindex) {
    const projectsdir = props.get('project', 'sourcePath', './projects/');
    const projectfile = path.join(projectsdir, projectid);
    const buildroot = fs.readFileSync(projectfile, 'utf-8');

    const replydir = path.join(buildroot, '.cmake', 'api', 'v1', 'reply');
    const replies = fs.readdirSync(replydir);

    const indexname = replies.find(reply => reply.startsWith('index-'));
    if (indexname === undefined) {
        console.log('could not find index file in '.concat(replydir));
        return 'failed';
    }
    else {
        const indexfile = path.join(replydir, indexname);
        const indexdata = JSON.parse(fs.readFileSync(indexfile, 'utf-8'));

        const pfile = path.join(replydir, indexdata['reply']['client-compiler-explorer']['codemodel-v2']['jsonFile']);
        const pdata = JSON.parse(fs.readFileSync(pfile, 'utf-8'));

        const configuration = _.find(pdata['configurations'], x => x['name'] === config);
        const configurationtarget = _.find(configuration['targets'], x => x['name'] === target);
        const tfile = path.join(replydir, configurationtarget['jsonFile']);
        const tdata = JSON.parse(fs.readFileSync(tfile, 'utf-8'));

        return {
            filepath: path.join(pdata['paths']['source'], tdata['sources'][fileindex]['path']),
            options: _.map(tdata['compileGroups'][tdata['sources'][fileindex]['compileGroupIndex']]['compileCommandFragments'] || [], x => x['fragment']),
            defines: _.map(tdata['compileGroups'][tdata['sources'][fileindex]['compileGroupIndex']]['defines'] || [], x => x['define']),
            includes: _.map(tdata['compileGroups'][tdata['sources'][fileindex]['compileGroupIndex']]['includes'] || [], x => x['path'])
        };
    }
}

function load(projectid, config, target, fileindex) {
    return new Promise(resolve => {
        const fileinfo = getFileinfo(projectid, config, target, fileindex);
        const options = _.reduce(fileinfo.options, (acc, val) => acc + ' ' + val, '');
        const defines = _.reduce(fileinfo.defines, (acc, val) => acc + ' ' + val, '');
        const includes = _.reduce(fileinfo.includes, (acc, val) => acc + ' ' + val, '');
        fs.readFile(fileinfo.filepath, 'utf-8', (err, res) => {
            resolve({ file: err ? 'Could not read file' : '// options:' + options + '\n' + '// defines:' + defines + '\n' + '// includes: ' + path.dirname(fileinfo.filepath) + includes + '\n' + res });
        });
    });
}

function list() {
    return new Promise(resolve => {
        const projectsdir = props.get('project', 'sourcePath', './projects/');
        fs.readdir(projectsdir, (err, projectids) => {
            if (err) {
                resolve({file: 'Could not read directory '.concat(projectsdir)});
            }
            else {
                var list = [];
                projectids.forEach(projectid => {
                    const projectfile = path.join(projectsdir, projectid);
                    const buildroot = fs.readFileSync(projectfile, 'utf-8');

                    const replydir = path.join(buildroot, '.cmake', 'api', 'v1', 'reply');
                    const replies = fs.readdirSync(replydir);

                    const indexname = replies.find(reply => reply.startsWith('index-'));
                    if (indexname === undefined) {
                        console.log('could not find index file in '.concat(replydir));
                    }
                    else {
                        const indexfile = path.join(replydir, indexname);
                        const indexdata = JSON.parse(fs.readFileSync(indexfile, 'utf-8'));

                        const pfile = path.join(replydir, indexdata['reply']['client-compiler-explorer']['codemodel-v2']['jsonFile']);
                        const pdata = JSON.parse(fs.readFileSync(pfile, 'utf-8'));

                        for (let i = 0; i < pdata['configurations'].length; i++) {
                            const configuration = pdata['configurations'][i];
                            for (let j = 0; j < configuration['targets'].length; j++) {
                                const tfile = path.join(replydir, configuration['targets'][j]['jsonFile']);
                                const tdata = JSON.parse(fs.readFileSync(tfile, 'utf-8'));

                                for (let i = 0; i < tdata['sourceGroups'].length; i++) {
                                    if (tdata['sourceGroups'][i]['name'] === 'Source Files') {
                                        for (let j in tdata['sourceGroups'][i]['sourceIndexes']) {
                                            list.push({
                                                'projectid': projectid,
                                                'projectdir': pdata['paths']['source'],
                                                'config': configuration['name'],
                                                'target': tdata['name'],
                                                'fileindex': j,
                                                'filename': tdata['sources'][j]['path'],
                                                'filepath': path.join(pdata['paths']['source'], tdata['sources'][j]['path'])
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                });

                resolve(list);
            }
        });
    });
}

module.exports.load = load;
module.exports.save = null;
module.exports.list = list;
module.exports.name = "Project files";
module.exports.urlpart = "project";
