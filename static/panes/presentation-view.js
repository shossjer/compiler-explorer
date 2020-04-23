// Copyright (c) 2020, Compiler Explorer Authors
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
//     * Redistributions of source code must retain the above copyright notice,
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
"use strict";

var monaco = require('monaco-editor');
var _ = require('underscore');
var $ = require('jquery');
var vis = require('vis');
var ga = require('../analytics');
var options = require('../options');
var languages = options.languages;

function PresentationView(hub, container, state) {
    this.container = container;
    this.eventHub = hub.createEventHub();
    this.domRoot = container.getElement();
    this.domRoot.html($('#presentationview').html());
    this.compilerService = hub.compilerService;

    this.currentLangId = "c++";
    this.compilerId = "clang_trunk";
    this.sourceEditorId = state.source;

    this.source = "";
    this.currentView = 0;

    state.options = state.options || {};

    this.state = state;

    this.level0view = monaco.editor.create(this.domRoot.find(".level0 .data")[0], {
        value: "",
        scrollBeyondLastLine: false,
        language: 'cpp',
        readOnly: true,
        glyphMargin: true,
        fontFamily: 'Consolas, "Liberation Mono", Courier, monospace',
        quickSuggestions: false,
        fixedOverflowWidgets: true,
        minimap: {
            maxColumn: 80
        },
        lineNumbersMinChars: 3
    });

    this.functions = [];
    this.networkOpts = {
        autoResize: true,
        locale: 'en',
        edges: {
            arrows: {to: {enabled: true}},
            smooth: {
                enabled: true,
                type: "dynamic",
                roundness: 1
            },
            physics: true
        },
        nodes: {
            font: {face: 'Consolas, "Liberation Mono", Courier, monospace', align: 'left'}
        },
        layout: {
            hierarchical: {
                enabled: true,
                direction: 'UD',
                nodeSpacing: 100,
                levelSeparation: 150
            }
        },
        physics: {
            enabled: !!state.options.physics,
            hierarchicalRepulsion: {
                nodeDistance: 160
            }
        },
        interaction: {
            navigationButtons: !!state.options.navigation,
            keyboard: {
                enabled: true,
                speed: {x: 10, y: 10, zoom: 0.03},
                bindToWindow: false
            }
        }
    };

    this.level1view = new vis.Network(this.domRoot.find('.level1 .data')[0], this.defaultCfgOutput, this.networkOpts);
    this.level2view = new vis.Network(this.domRoot.find('.level2 .data')[0], this.defaultCfgOutput, this.networkOpts);
    this.level3view = new vis.Network(this.domRoot.find('.level3 .data')[0], this.defaultCfgOutput, this.networkOpts);
    this.level4view = new vis.Network(this.domRoot.find('.level4 .data')[0], this.defaultCfgOutput, this.networkOpts);

    this.initButtons();
    this.initCallbacks();
}

PresentationView.prototype.getCompilerArgumentsForView = function () {
    if (this.currentView === 0) {
        return "-E";
    } else if (this.currentView === 1) {
        return "-O0";
    } else if (this.currentView === 2) {
        return "-O1";
    } else if (this.currentView === 3) {
        return "-O2";
    } else if (this.currentView === 4) {
        return "-O3";
    }
};

PresentationView.prototype.onEditorChange = function (editor, source, langId, compilerId) {
    if (editor === this.sourceEditorId && langId === this.currentLangId &&
        (compilerId === undefined || compilerId === this.id)) {
        this.source = source;
        this.compile();
    }
};

PresentationView.prototype.compile = function () {
    this.needsCompile = false;
    //this.compileTimeLabel.text(' - Compiling...');
    var options = {
        userArguments: this.getCompilerArgumentsForView(),
        compilerOptions: {
            produceCfg: this.currentView > 0
        },
        filters: {
            binary: false,
            execute: false,
            intel: true,
            demangle: true,
            labels: true,
            libraryCode: false,
            directives: true,
            commentOnly: true,
            trim: false
        },
        tools: [],
        libraries: []
    };

    this.compilerService.expand(this.source).then(_.bind(function (expanded) {
        var request = {
            source: expanded || '',
            compiler: this.compilerId,
            options: options,
            lang: this.currentLangId
        };

        this.sendCompile(request);
    }, this));
};

PresentationView.prototype.setAssembly = function (asm) {
    this.assembly = asm;
    if (!this.level0view || !this.level0view.getModel()) return;
    var editorModel = this.level0view.getModel();
    editorModel.setValue(asm.length ? _.pluck(asm, 'text').join('\n') : "<No assembly generated>");

    if (!this.awaitingInitialResults) {
        if (this.selection) {
            this.level0view.setSelection(this.selection);
            this.level0view.revealLinesInCenter(
                this.selection.startLineNumber, this.selection.endLineNumber);
        }
        this.awaitingInitialResults = true;
    } else {
        var visibleRanges = this.level0view.getVisibleRanges();
        var currentTopLine =
            visibleRanges.length > 0 ? visibleRanges[0].startLineNumber : 1;
        this.level0view.revealLine(currentTopLine);
    }
};

PresentationView.prototype.postCompilationResult = function () {

};

function fakeAsm(text) {
    return [{text: text, source: null, fake: true}];
}

function errorResult(message) {
    return {message: message};
}

PresentationView.prototype.sendCompile = function (request) {
    var onCompilerResponse = _.bind(this.onCompileResponse, this);

    this.eventHub.emit('compiling', this.id, this.compiler);
    // Display the spinner
    //    this.handleCompilationStatus({code: 4});
    this.pendingRequestSentAt = Date.now();
    // After a short delay, give the user some indication that we're working on their
    // compilation.
    var progress = setTimeout(_.bind(function () {
        this.setAssembly(fakeAsm('<Compiling...>'));
    }, this), 500);
    this.compilerService.submit(request)
        .then(function (x) {
            clearTimeout(progress);
            onCompilerResponse(request, x.result, x.localCacheHit);
        })
        .catch(function (x) {
            clearTimeout(progress);
            var message = "Unknown error";
            if (_.isString(x)) {
                message = x;
            } else if (x) {
                message = x.error || x.code;
            }
            onCompilerResponse(request,
                errorResult('<Compilation failed: ' + message + '>'), false);
        });
};

PresentationView.prototype.onCompileResponse = function (request, result) {
    var cached = false;

    // Delete trailing empty lines
    if ($.isArray(result.asm)) {
        var indexToDiscard = _.findLastIndex(result.asm, function (line) {
            return !_.isEmpty(line.text);
        });
        result.asm.splice(indexToDiscard + 1, result.asm.length - indexToDiscard);
    }
    // Save which source produced this change. It should probably be saved earlier though
    result.source = this.source;
    this.lastResult = result;
    var timeTaken = Math.max(0, Date.now() - this.pendingRequestSentAt);
    //var wasRealReply = this.pendingRequestSentAt > 0;
    this.pendingRequestSentAt = 0;
    ga.proxy('send', {
        hitType: 'event',
        eventCategory: 'Compile',
        eventAction: request.compiler,
        eventLabel: request.options.userArguments,
        eventValue: cached ? 1 : 0
    });
    ga.proxy('send', {
        hitType: 'timing',
        timingCategory: 'Compile',
        timingVar: request.compiler,
        timingValue: timeTaken
    });

    //this.labelDefinitions = result.labelDefinitions || {};
    this.setAssembly(result.asm || fakeAsm('<No output>'));

    // var stdout = result.stdout || [];
    // var stderr = result.stderr || [];

    // var allText = _.pluck(stdout.concat(stderr), 'text').join('\n');
    // var failed = result.code !== 0;
    //var warns = !failed && !!allText;
    //this.handleCompilationStatus({code: failed ? 3 : (warns ? 2 : 1), compilerOut: result.code});
    //this.outputTextCount.text(stdout.length);
    //this.outputErrorCount.text(stderr.length);
    if (this.isOutputOpened) {
        //this.outputBtn.prop('title', '');
    } else {
        //this.outputBtn.prop('title', allText.replace(/\x1b\[[0-9;]*m(.\[K)?/g, ''));
    }
    // var timeLabelText = '';
    // if (cached) {
    //     timeLabelText = ' - cached';
    // } else if (wasRealReply) {
    //     timeLabelText = ' - ' + timeTaken + 'ms';
    // }

    // if (result.asmSize !== undefined) {
    //     timeLabelText += ' (' + result.asmSize + 'B)';
    // }

    //    this.compileTimeLabel.text(timeLabelText);

    this.postCompilationResult(request, result);
    this.eventHub.emit('compileResult', this.id, this.compiler, result, languages[this.currentLangId]);
};

PresentationView.prototype.initButtons = function () {
    this.domRoot.find('.left').click(_.bind(this.left, this));
    this.domRoot.find('.right').click(_.bind(this.right, this));
};

PresentationView.prototype.initCallbacks = function () {
    this.container.on('resize', this.resize, this);
    this.eventHub.on('editorChange', this.onEditorChange, this);
};

PresentationView.prototype.hideView = function (level) {
    if (level === 0) {
        this.domRoot.find('.level0').hide();
    } else if (level === 1) {
        this.domRoot.find('.level1').hide();
    } else if (level === 2) {
        this.domRoot.find('.level2').hide();
    } else if (level === 3) {
        this.domRoot.find('.level3').hide();
    } else if (level === 4) {
        this.domRoot.find('.level4').hide();
    }
};

PresentationView.prototype.showView = function (level) {
    if (level === 0) {
        this.domRoot.find('.level0').show();
    } else if (level === 1) {
        this.domRoot.find('.level1').show();
    } else if (level === 2) {
        this.domRoot.find('.level2').show();
    } else if (level === 3) {
        this.domRoot.find('.level3').show();
    } else if (level === 4) {
        this.domRoot.find('.level4').show();
    }

    this.compile();
};

PresentationView.prototype.left = function () {
    if (this.currentView > 0) {
        this.hideView(this.currentView);
        this.currentView--;
        this.showView(this.currentView);
    }
};

PresentationView.prototype.right = function () {
    if (this.currentView < 4) {
        this.hideView(this.currentView);
        this.currentView++;
        this.showView(this.currentView);
    }
};

PresentationView.prototype.resize = function () {
    if (this.currentView === 0) {
        this.level0view.layout({
            width: this.domRoot.width(),
            height: this.domRoot.height() - this.domRoot.find('.top-bar').height()
        });
    }
};

module.exports = {
    PresentationView: PresentationView
};
