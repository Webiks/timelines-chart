import './timelines.css';

import Kapsule from 'kapsule';

import {ascending as d3Ascending, max as d3Max, min as d3Min, range as d3Range} from 'd3-array';
import {axisBottom as d3AxisBottom, axisLeft as d3AxisLeft, axisTop as d3AxisTop} from 'd3-axis';
import {
    scaleLinear as d3ScaleLinear,
    scaleOrdinal as d3ScaleOrdinal,
    scalePoint as d3ScalePoint,
    scaleSequential as d3ScaleSequential,
    scaleTime as d3ScaleTime,
    scaleUtc as d3ScaleUtc
} from 'd3-scale';

import {event as d3Event, mouse as d3Mouse, select as d3Select} from 'd3-selection';
import {timeFormat as d3TimeFormat, utcFormat as d3UtcFormat} from 'd3-time-format';
import d3Tip from 'd3-tip';
import {interpolateRdYlBu, schemeCategory10, schemeSet3} from 'd3-scale-chromatic';

import {gradient as Gradient, moveToFront as MoveToFront} from 'svg-utils';
import {fitToBox as TextFitToBox} from 'svg-text-fit';
import ColorLegend from 'd3-color-legend';
import TimeOverview from './time-overview.js';
import {alphaNumCmp} from './comparison.js';


export default Kapsule({
    props: {
        data: {
            default: [],
            onChange(data, state) {
                parseData(data);

                state.zoomX = [
                    d3Min(state.completeFlatData, d => d.timeRange[0]),
                    d3Max(state.completeFlatData, d => d.timeRange[1])
                ];

                state.zoomY = [null, null];

                if (state.overviewArea) {
                    state.overviewArea
                        .domainRange(state.zoomX)
                        .currentSelection(state.zoomX);
                }

                //

                function parseData(rawData) {

                    state.completeStructData = [];
                    state.completeFlatData = [];
                    state.totalNLines = 0;

                    const dateObjs = rawData.length ? rawData[0].data[0].data[0].timeRange[0] instanceof Date : false;

                    for (let i = 0, ilen = rawData.length; i < ilen; i++) {
                        const group = rawData[i].group;
                        state.completeStructData.push({
                            group: group,
                            lines: rawData[i].data.map(d => d.label)
                        });

                        for (let j = 0, jlen = rawData[i].data.length; j < jlen; j++) {
                            for (let k = 0, klen = rawData[i].data[j].data.length; k < klen; k++) {
                                state.completeFlatData.push({
                                    group: group,
                                    label: rawData[i].data[j].label,
                                    timeRange: (dateObjs
                                            ? rawData[i].data[j].data[k].timeRange
                                            : [new Date(rawData[i].data[j].data[k].timeRange[0]), new Date(rawData[i].data[j].data[k].timeRange[1])]
                                    ),
                                    val: rawData[i].data[j].data[k].val,
                                    labelVal: rawData[i].data[j].data[k][rawData[i].data[j].data[k].hasOwnProperty('labelVal') ? 'labelVal' : 'val']
                                });
                            }
                            state.totalNLines++;
                        }
                    }
                }
            }
        },
        width: {default: window.innerWidth},
        maxHeight: {default: 640},
        maxLineHeight: {default: 12},
        leftMargin: {default: 90},
        rightMargin: {default: 100},
        topMargin: {default: 26},
        bottomMargin: {default: 30},
        useUtc: {default: false},
        xTickFormat: {},
        boldRule: {
            default: {
                field: 'unitLevel',
                values: {
                    1: 'bold',
                }
            }
        },
        labelRule: {
            default: {
                field: 'unitLevel',
                values: {
                    1: 'bold',
                }
            }
        },
        timeFormat: {default: '%Y-%m-%d %-I:%M:%S %p', triggerUpdate: false},
        zoomX: {  // Which time-range to show (null = min/max)
            default: [null, null],
            onChange(zoomX, state) {
                if (state.svg)
                    state.svg.dispatch('zoom', {
                        detail: {
                            zoomX: zoomX,
                            zoomY: null,
                            redraw: false
                        }
                    });
            }
        },
        zoomY: {  // Which lines to show (null = min/max) [0 indexed]
            default: [null, null],
            onChange(zoomY, state) {
                if (state.svg)
                    state.svg.dispatch('zoom', {
                        detail: {
                            zoomX: null,
                            zoomY: zoomY,
                            redraw: false
                        }
                    });
            }
        },
        minSegmentDuration: {},
        zColorScale: {default: d3ScaleSequential(interpolateRdYlBu)},
        zQualitative: {
            default: false, onChange(discrete, state) {
                state.zColorScale = discrete
                    ? d3ScaleOrdinal([...schemeCategory10, ...schemeSet3])
                    : d3ScaleSequential(interpolateRdYlBu); // alt: d3.interpolateInferno
            }
        },
        zDataLabel: {default: '', triggerUpdate: false}, // Units of z data. Used in the tooltip descriptions
        zScaleLabel: {default: '', triggerUpdate: false}, // Units of colorScale. Used in the legend label
        enableOverview: {default: true}, // True/False
        enableAnimations: {
            default: true,
            onChange(val, state) {
                state.transDuration = val ? 700 : 0;
            }
        },

        // Callbacks
        onZoom: {}, // When user zooms in / resets zoom. Returns ([startX, endX], [startY, endY])
        onLabelClick: {} // When user clicks on a group or y label. Returns (group) or (label, group) respectively
    },

    methods: {
        getNLines: s => s.nLines,
        getTotalNLines: s => s.totalNLines,
        getVisibleStructure: s => s.structData,
        getSvg: s => d3Select(s.svg.node().parentNode).html(),
        zoomYLabels(state, _) {
            if (!_) {
                return [y2Label(state.zoomY[0]), y2Label(state.zoomY[1])];
            }
            return this.zoomY([label2Y(_[0], true), label2Y(_[1], false)]);

            //

            function y2Label(y) {

                if (y == null) return y;

                let cntDwn = y;
                for (let i = 0, len = state.completeStructData.length; i < len; i++) {
                    if (state.completeStructData[i].lines.length > cntDwn)
                        return getIdxLine(state.completeStructData[i], cntDwn);
                    cntDwn -= state.completeStructData[i].lines.length;
                }

                // y larger than all lines, return last
                return getIdxLine(state.completeStructData[state.completeStructData.length - 1], state.completeStructData[state.completeStructData.length - 1].lines.length - 1);

                //

                function getIdxLine(grpData, idx) {
                    return {
                        'group': grpData.group,
                        'label': grpData.lines[idx]
                    };
                }
            }

            function label2Y(label, useIdxAfterIfNotFound) {

                useIdxAfterIfNotFound = useIdxAfterIfNotFound || false;
                const subIdxNotFound = useIdxAfterIfNotFound ? 0 : 1;

                if (label == null) return label;

                let idx = 0;
                for (let i = 0, lenI = state.completeStructData.length; i < lenI; i++) {
                    const grpCmp = state.grpCmpFunction(label.group, state.completeStructData[i].group);
                    if (grpCmp < 0) break;
                    if (grpCmp == 0 && label.group == state.completeStructData[i].group) {
                        for (let j = 0, lenJ = state.completeStructData[i].lines.length; j < lenJ; j++) {
                            const cmpRes = state.labelCmpFunction(label.label, state.completeStructData[i].lines[j]);
                            if (cmpRes < 0) {
                                return idx + j - subIdxNotFound;
                            }
                            if (cmpRes == 0 && label.label == state.completeStructData[i].lines[j]) {
                                return idx + j;
                            }
                        }
                        return idx + state.completeStructData[i].lines.length - subIdxNotFound;
                    }
                    idx += state.completeStructData[i].lines.length;
                }
                return idx - subIdxNotFound;
            }
        },
        sort(state, labelCmpFunction, grpCmpFunction) {
            if (labelCmpFunction == null) {
                labelCmpFunction = state.labelCmpFunction
            }
            if (grpCmpFunction == null) {
                grpCmpFunction = state.grpCmpFunction
            }

            state.labelCmpFunction = labelCmpFunction;
            state.grpCmpFunction = grpCmpFunction;

            state.completeStructData.sort((a, b) => grpCmpFunction(a.group, b.group));

            for (let i = 0, len = state.completeStructData.length; i < len; i++) {
                state.completeStructData[i].lines.sort(labelCmpFunction);
            }

            state._rerender();

            return this;
        },
        sortAlpha(state, asc) {
            if (asc == null) {
                asc = true
            }
            const alphaCmp = function (a, b) {
                return alphaNumCmp(asc ? a : b, asc ? b : a);
            };
            return this.sort(alphaCmp, alphaCmp);
        },
        sortChrono(state, asc) {
            if (asc == null) {
                asc = true
            }

            function buildIdx(accessFunction) {
                const idx = {};
                for (let i = 0, len = state.completeFlatData.length; i < len; i++) {
                    const key = accessFunction(state.completeFlatData[i]);
                    if (idx.hasOwnProperty(key)) {
                        continue;
                    }

                    const itmList = state.completeFlatData.filter(d => key == accessFunction(d));
                    idx[key] = [
                        d3Min(itmList, d => d.timeRange[0]),
                        d3Max(itmList, d => d.timeRange[1])
                    ];
                }
                return idx;
            }

            const timeCmp = function (a, b) {

                const aT = a[1], bT = b[1];

                if (!aT || !bT) return null; // One of the two vals is null

                if (aT[1].getTime() == bT[1].getTime()) {
                    if (aT[0].getTime() == bT[0].getTime()) {
                        return alphaNumCmp(a[0], b[0]); // If first and last is same, use alphaNum
                    }
                    return aT[0] - bT[0];   // If last is same, earliest first wins
                }
                return bT[1] - aT[1]; // latest last wins
            };

            function getCmpFunction(accessFunction, asc) {
                return (a, b) => timeCmp(accessFunction(asc ? a : b), accessFunction(asc ? b : a));
            }

            const grpIdx = buildIdx(d => d.group);
            const lblIdx = buildIdx(d => d.label);

            const grpCmp = getCmpFunction(d => [d, grpIdx[d] || null], asc);
            const lblCmp = getCmpFunction(d => [d, lblIdx[d] || null], asc);

            return this.sort(lblCmp, grpCmp);
        },
        overviewDomain(state, _) {
            if (!state.enableOverview) {
                return null;
            }

            if (!_) {
                return state.overviewArea.domainRange();
            }
            state.overviewArea.domainRange(_);
            return this;
        },
        refresh(state) {
            state._rerender();
            return this;
        }
    },

    stateInit: {
        height: null,
        overviewHeight: 20, // Height of overview section in bottom
        minLabelFont: 2,
        groupBkgGradient: ['#FAFAFA', '#E0E0E0'],
        boldRule: null,
        labelRule: null,
        yScale: null,
        grpScale: null,

        xAxis: null,
        xGrid: null,
        yAxis: null,


        svg: null,
        graph: null,
        overviewAreaElem: null,
        overviewArea: null,

        graphW: null,
        graphH: null,

        completeStructData: null,
        structData: null,
        completeFlatData: null,
        flatData: null,
        totalNLines: null,
        nLines: null,

        minSegmentDuration: 0, // ms

        transDuration: 700,   // ms for transition duration

        labelCmpFunction: alphaNumCmp,
        grpCmpFunction: alphaNumCmp
    },

    init(el, state) {
        console.log(state)
        const elem = d3Select(el)
            .attr('class', 'timelines-chart');

        state.svg = elem.append('svg').attr('direction', 'ltr');
        state.overviewAreaElem = elem.append('div');

        // Initialize scales and axes
        state.yScale = d3ScalePoint();
        state.grpScale = d3ScaleOrdinal();
        state.xAxis = d3AxisBottom();
        state.xGrid = d3AxisTop();
        state.yAxis = d3AxisLeft();
        buildDomStructure();
        addTooltips();
        addZoomSelection();
        setEvents();

        //

        function buildDomStructure() {

            state.yScale.invert = invertOrdinal;
            state.grpScale.invert = invertOrdinal;

            state.groupGradId = Gradient()
                .colorScale(d3ScaleLinear()
                    .domain([0, 1])
                    .range(state.groupBkgGradient))
                .angle(-90)
                (state.svg.node())
                .id();

            const axises = state.svg.append('g').attr('class', 'axises');
            axises.append('g').attr('class', 'x-axis');
            axises.append('g').attr('class', 'x-grid');
            axises.append('g').attr('class', 'y-axis')

            state.yAxis.scale(state.yScale)
                .tickSize(20);


            state.colorLegend = ColorLegend()
            (state.svg.append('g')
                .attr('class', 'legendG')
                .node()
            );

            state.graph = state.svg.append('g');

            if (state.enableOverview) {
                addOverviewArea();
            }

            // Applies to ordinal scales (invert not supported in d3)
            function invertOrdinal(val, cmpFunc) {
                cmpFunc = cmpFunc || function (a, b) {
                    return (a >= b);
                };

                const scDomain = this.domain();
                let scRange = this.range();

                if (scRange.length === 2 && scDomain.length !== 2) {
                    // Special case, interpolate range vals
                    scRange = d3Range(scRange[0], scRange[1], (scRange[1] - scRange[0]) / scDomain.length);
                }

                const bias = scRange[0];
                for (let i = 0, len = scRange.length; i < len; i++) {
                    if (cmpFunc(scRange[i] + bias, val)) {
                        return scDomain[Math.round(i * scDomain.length / scRange.length)];
                    }
                }

                return this.domain()[this.domain().length - 1];
            }

            function addOverviewArea() {
                state.overviewArea = TimeOverview()
                    .margins({top: 1, right: 20, bottom: 20, left: 20})
                    .onChange((startTime, endTime) => {
                        state.svg.dispatch('zoom', {
                            detail: {
                                zoomX: [startTime, endTime],
                                zoomY: null
                            }
                        });
                    })
                    .domainRange(state.zoomX)
                    .currentSelection(state.zoomX)
                    (state.overviewAreaElem.node());

                state.svg.on('zoomScent', function () {
                    const zoomX = d3Event.detail.zoomX;

                    if (!state.overviewArea || !zoomX) return;

                    // Out of overview bounds
                    if (zoomX[0] < state.overviewArea.domainRange()[0] || zoomX[1] > state.overviewArea.domainRange()[1]) {
                        state.overviewArea.update(
                            [
                                new Date(Math.min(zoomX[0], state.overviewArea.domainRange()[0])),
                                new Date(Math.max(zoomX[1], state.overviewArea.domainRange()[1]))
                            ],
                            state.zoomX
                        );
                    } else { // Normal case
                        state.overviewArea.currentSelection(zoomX);
                    }
                });
            }

        }

        function addTooltips() {
            state.groupTooltip = d3Tip()
                .attr('class', 'chart-tooltip group-tooltip')
                .style('visibility', 'hidden')
                .direction('w')
                .offset([0, 0])
                .html(d => {
                    const leftPush = (d.hasOwnProperty('timeRange')
                            ? state.xScale(d.timeRange[0])
                            : 0
                    );
                    const topPush = (d.hasOwnProperty('label')
                            ? state.grpScale(d.group) - state.yScale(d.group + '+&+' + d.label)
                            : 0
                    );
                    state.groupTooltip.offset([topPush, -leftPush]);
                    return d.group;
                });

            state.svg.call(state.groupTooltip);

            state.lineTooltip = d3Tip()
                .attr('class', 'chart-tooltip line-tooltip')
                .style('visibility', 'hidden')
                .direction('e')
                .offset([0, 0])
                .html(d => {
                    const rightPush = (d.hasOwnProperty('timeRange') ? state.xScale.range()[1] - state.xScale(d.timeRange[1]) : 0);
                    state.lineTooltip.offset([0, rightPush]);
                    return d.label;
                });

            state.svg.call(state.lineTooltip);

            state.segmentTooltip = d3Tip()
                .attr('class', 'chart-tooltip segment-tooltip')
                .direction('s')
                .offset([5, 0])
                .html(d => {
                    const normVal = state.zColorScale.domain()[state.zColorScale.domain().length - 1] - state.zColorScale.domain()[0];
                    const dateFormat = (state.useUtc ? d3UtcFormat : d3TimeFormat)(`${state.timeFormat}${state.useUtc ? ' (UTC)' : ''}`);
                    return '<strong>' + d.labelVal + ' </strong>' + state.zDataLabel
                        + (false ? ' (<strong>' + Math.round((d.val - state.zColorScale.domain()[0]) / normVal * 100 * 100) / 100 + '%</strong>)' : '') + '<br>'
                        + '<strong>From: </strong>' + dateFormat(d.timeRange[0]) + '<br>'
                        + '<strong>To: </strong>' + dateFormat(d.timeRange[1]);
                });

            state.svg.call(state.segmentTooltip);
        }

        function addZoomSelection() {
            state.graph.on('mousedown', function () {
                if (d3Select(window).on('mousemove.zoomRect') != null) // Selection already active
                    return;

                const e = this;

                if (d3Mouse(e)[0] < 0 || d3Mouse(e)[0] > state.graphW || d3Mouse(e)[1] < 0 || d3Mouse(e)[1] > state.graphH)
                    return;

                state.disableHover = true;

                const rect = state.graph.append('rect')
                    .attr('class', 'chart-zoom-selection');

                const startCoords = d3Mouse(e);

                d3Select(window)
                    .on('mousemove.zoomRect', function () {
                        d3Event.stopPropagation();
                        const newCoords = [
                            Math.max(0, Math.min(state.graphW, d3Mouse(e)[0])),
                            Math.max(0, Math.min(state.graphH, d3Mouse(e)[1]))
                        ];
                        rect.attr('x', Math.min(startCoords[0], newCoords[0]))
                            .attr('y', Math.min(startCoords[1], newCoords[1]))
                            .attr('width', Math.abs(newCoords[0] - startCoords[0]))
                            .attr('height', Math.abs(newCoords[1] - startCoords[1]));

                        state.svg.dispatch('zoomScent', {
                            detail: {
                                zoomX: [startCoords[0], newCoords[0]].sort(d3Ascending).map(state.xScale.invert),
                                zoomY: [startCoords[1], newCoords[1]].sort(d3Ascending).map(d =>
                                    state.yScale.domain().indexOf(state.yScale.invert(d))
                                    + ((state.zoomY && state.zoomY[0]) ? state.zoomY[0] : 0)
                                )
                            }
                        });
                    })
                    .on('mouseup.zoomRect', function () {
                        d3Select(window).on('mousemove.zoomRect', null).on('mouseup.zoomRect', null);
                        d3Select('body').classed('stat-noselect', false);
                        rect.remove();
                        state.disableHover = false;

                        const endCoords = [
                            Math.max(0, Math.min(state.graphW, d3Mouse(e)[0])),
                            Math.max(0, Math.min(state.graphH, d3Mouse(e)[1]))
                        ];

                        if (startCoords[0] == endCoords[0] && startCoords[1] == endCoords[1])
                            return;

                        const newDomainX = [startCoords[0], endCoords[0]].sort(d3Ascending).map(state.xScale.invert);

                        const newDomainY = [startCoords[1], endCoords[1]].sort(d3Ascending).map(d =>
                            state.yScale.domain().indexOf(state.yScale.invert(d))
                            + ((state.zoomY && state.zoomY[0]) ? state.zoomY[0] : 0)
                        );

                        const changeX = ((newDomainX[1] - newDomainX[0]) > (60 * 1000)); // Zoom damper
                        const changeY = (newDomainY[0] != state.zoomY[0] || newDomainY[1] != state.zoomY[1]);

                        if (changeX || changeY) {
                            state.svg.dispatch('zoom', {
                                detail: {
                                    zoomX: changeX ? newDomainX : null,
                                    zoomY: changeY ? newDomainY : null
                                }
                            });
                        }



                    }, true);

                d3Event.stopPropagation();
            });

            state.resetBtn = state.svg.append('text')
                .attr('class', 'reset-zoom-btn')
                .text('Reset Zoom')
                .style('text-anchor', 'end')
                .on('mouseup', function () {
                    state.svg.dispatch('resetZoom');
                })
                .on('mouseover', function () {
                    d3Select(this).style('opacity', 1);
                })
                .on('mouseout', function () {
                    d3Select(this).style('opacity', .6);
                });
        }

        function setEvents() {

            state.svg.on('zoom', function () {
                const evData = d3Event.detail,
                    zoomX = evData.zoomX,
                    zoomY = evData.zoomY,
                    redraw = (evData.redraw == null) ? true : evData.redraw;

                if (!zoomX && !zoomY) return;

                if (zoomX) state.zoomX = zoomX;
                if (zoomY) state.zoomY = zoomY;

                state.svg.dispatch('zoomScent', {
                    detail: {
                        zoomX: zoomX,
                        zoomY: zoomY
                    }
                });

                if (!redraw) return;

                state._rerender();
                if (state.onZoom) state.onZoom(state.zoomX, state.zoomY);
            });

            state.svg.on('resetZoom', function () {
                const prevZoomX = state.zoomX;
                const prevZoomY = state.zoomY || [null, null];

                const newZoomX = state.enableOverview
                    ? state.overviewArea.domainRange()
                    : [
                        d3Min(state.flatData, d => d.timeRange[0]),
                        d3Max(state.flatData, d => d.timeRange[1])
                    ],
                    newZoomY = [null, null];

                if (prevZoomX[0] < newZoomX[0] || prevZoomX[1] > newZoomX[1]
                    || prevZoomY[0] != newZoomY[0] || prevZoomY[1] != newZoomX[1]) {

                    state.zoomX = [
                        new Date(Math.min(prevZoomX[0], newZoomX[0])),
                        new Date(Math.max(prevZoomX[1], newZoomX[1]))
                    ];
                    state.zoomY = newZoomY;
                    state.svg.dispatch('zoomScent', {
                        detail: {
                            zoomX: state.zoomX,
                            zoomY: state.zoomY
                        }
                    });

                    state._rerender();
                }

                if (state.onZoom) state.onZoom(null, null);
            });
        }
    },

    update(state) {

        applyFilters();
        setupDimensions();

        adjustXScale();
        adjustYScale();
        adjustGrpScale();

        renderAxises();
        renderGroups();

        renderTimelines();
        adjustLegend();

        //

        function applyFilters() {
            // Flat data based on segment length
            state.flatData = (state.minSegmentDuration > 0
                    ? state.completeFlatData.filter(d => (d.timeRange[1] - d.timeRange[0]) >= state.minSegmentDuration)
                    : state.completeFlatData
            );

            // zoomY
            if (state.zoomY == null || state.zoomY == [null, null]) {
                state.structData = state.completeStructData;
                state.nLines = 0;
                for (let i = 0, len = state.structData.length; i < len; i++) {
                    state.nLines += state.structData[i].lines.length;
                }
                return;
            }

            state.structData = [];
            const cntDwn = [state.zoomY[0] == null ? 0 : state.zoomY[0]]; // Initial threshold
            cntDwn.push(Math.max(0, (state.zoomY[1] == null ? state.totalNLines : state.zoomY[1] + 1) - cntDwn[0])); // Number of lines
            state.nLines = cntDwn[1];
            for (let i = 0, len = state.completeStructData.length; i < len; i++) {

                let validLines = state.completeStructData[i].lines;

                if (state.minSegmentDuration > 0) {  // Use only non-filtered (due to segment length) groups/labels
                    if (!state.flatData.some(d => d.group == state.completeStructData[i].group)) {
                        continue; // No data for this group
                    }

                    validLines = state.completeStructData[i].lines
                        .filter(d => state.flatData.some(dd =>
                            dd.group == state.completeStructData[i].group && dd.label == d
                            )
                        );
                }

                if (cntDwn[0] >= validLines.length) { // Ignore whole group (before start)
                    cntDwn[0] -= validLines.length;
                    continue;
                }

                const groupData = {
                    group: state.completeStructData[i].group,
                    lines: null
                };

                if (validLines.length - cntDwn[0] >= cntDwn[1]) {  // Last (or first && last) group (partial)
                    groupData.lines = validLines.slice(cntDwn[0], cntDwn[1] + cntDwn[0]);
                    state.structData.push(groupData);
                    cntDwn[1] = 0;
                    break;
                }

                if (cntDwn[0] > 0) {  // First group (partial)
                    groupData.lines = validLines.slice(cntDwn[0]);
                    cntDwn[0] = 0;
                } else {  // Middle group (full fit)
                    groupData.lines = validLines;
                }

                state.structData.push(groupData);
                cntDwn[1] -= groupData.lines.length;
            }

            state.nLines -= cntDwn[1];
        }

        function setupDimensions() {
            state.graphW = state.width - state.leftMargin - state.rightMargin;
            state.graphH = d3Min([state.nLines * state.maxLineHeight, state.maxHeight - state.topMargin - state.bottomMargin]);
            state.height = state.graphH + state.topMargin + state.bottomMargin;

            state.svg.transition().duration(state.transDuration)
                .attr('width', state.width)
                .attr('height', state.height);

            state.graph.attr('transform', 'translate(' + state.leftMargin + ',' + state.topMargin + ')');

            if (state.overviewArea) {
                state.overviewArea
                    .width(state.width * 0.8)
                    .height(state.overviewHeight + state.overviewArea.margins().top + state.overviewArea.margins().bottom);
            }
        }

        function adjustXScale() {
            state.zoomX[0] = state.zoomX[0] || d3Min(state.flatData, d => d.timeRange[0]);
            state.zoomX[1] = state.zoomX[1] || d3Max(state.flatData, d => d.timeRange[1]);

            state.xScale = (state.useUtc ? d3ScaleUtc : d3ScaleTime)()
                .domain(state.zoomX)
                .range([0, state.graphW])
                .clamp(true);

            if (state.overviewArea) {
                state.overviewArea
                    .scale(state.xScale.copy())
                    .tickFormat(state.xTickFormat);
            }
        }

        function adjustYScale() {
            let labels = [];
            for (let i = 0, len = state.structData.length; i < len; i++) {
                labels = labels.concat(state.structData[i].lines.map(function (d) {
                    return state.structData[i].group + '+&+' + d
                }));
            }

            state.yScale.domain(labels);
            state.yScale.range([state.graphH / labels.length * 0.5, state.graphH * (1 - 0.5 / labels.length)]);




        }

        function adjustGrpScale() {
            state.grpScale.domain(state.structData.map(d => d.group));

            let cntLines = 0;
            state.grpScale.range(state.structData.map(d => {
                const pos = (cntLines + d.lines.length / 2) / state.nLines * state.graphH;
                cntLines += d.lines.length;
                return pos;
            }));
        }

        function adjustLegend() {
            state.svg.select('.legendG')
                .transition().duration(state.transDuration)
                .attr('transform', `translate(${state.leftMargin + state.graphW * 0.05},2)`);

            state.colorLegend
                .width(Math.max(120, state.graphW / 3 * (state.zQualitative ? 2 : 1)))
                .height(state.topMargin * .6)
                .scale(state.zColorScale)
                .label(state.zScaleLabel);

            state.resetBtn
                .transition().duration(state.transDuration)
                .attr('x', state.leftMargin + state.graphW * .99)
                .attr('y', state.topMargin * .8);

            TextFitToBox()
                .bbox({
                    width: state.graphW * .4,
                    height: Math.min(13, state.topMargin * .8)
                })
                (state.resetBtn.node());

        }

        function renderAxises() {

            state.svg.select('.axises')
                .attr('transform', 'translate(' + state.leftMargin + ',' + state.topMargin + ')');

            // X.
            state.xAxis
                .scale(state.xScale)
                .ticks(Math.round(state.graphW * 0.0011))
                .tickFormat(state.xTickFormat);
            state.xGrid
                .scale(state.xScale)
                .ticks(state.xAxis.ticks()[0])
                .tickFormat('');

            state.svg.select('g.x-axis')
                .style('stroke-opacity', 0)
                .style('fill-opacity', 0)
                .attr('transform', 'translate(0,' + state.graphH + ')')
                .transition().duration(state.transDuration)
                .call(state.xAxis)
                .style('stroke-opacity', 1)
                .style('fill-opacity', 1);

            /* Angled x axis labels
             state.svg.select('g.x-axis').selectAll('text')
             .style('text-anchor', 'end')
             .attr('transform', 'translate(-10, 3) rotate(-60)');
             */

            state.xGrid.tickSize(state.graphH);
            state.svg.select('g.x-grid')
                .attr('transform', 'translate(0,' + state.graphH + ')')
                .transition().duration(state.transDuration)
                .call(state.xGrid);

            // Y
            const fontVerticalMargin = 0.6;
            const labelDisplayRatio = Math.ceil(state.nLines * state.minLabelFont / Math.sqrt(2) / state.graphH / fontVerticalMargin);
            const tickVals = state.yScale.domain()
                .filter((d, i) => !(i % labelDisplayRatio))
                // .map(d => {
                //     console.log("Fsdfds")
                //     let spaceStr = '';
                //     const requiredLength = (maxChars - d.length) / 2;
                //     for (var i = 0; i < requiredLength; i++) {
                //         spaceStr.concat(' ')
                //     };
                //     return spaceStr + d + spaceStr
                // });

            let fontSize = 12 || Math.min(12, state.graphH / tickVals.length * fontVerticalMargin * Math.sqrt(2));
            let maxChars = Math.ceil(state.rightMargin / (fontSize / Math.sqrt(2)));

            state.yAxis.tickValues(tickVals);
            state.yAxis.tickFormat(d => reduceLabel(d.split('+&+')[1], maxChars));

            state.svg.select('g.y-axis')
                .transition().duration(state.transDuration)
                .attr('transform', 'translate(' + 0 + ', 0)')
                .style('font-size', 12) // state.nLines < 14 ? '20px' : fontSize + 'px')
                .call(state.yAxis);


            const ticks = state.svg.select('g.y-axis').selectAll('.tick')
            setTimeout(() => {

                ticks
                    .attr('font-weight', (d) => {
                        switch (d.replace(/[^/]/g, "").length) {
                            case 0:
                                return '900';
                            case 1:
                                return '400';
                            default:
                                return '100'
                        }
                        // if (d && state.boldRule && state.boldRule.values && state.boldRule.field && d[state.boldRule.field]) {
                        //     return state.boldRule.values[state.boldRule.field]
                        // }
                    })
                    .attr('font-style', (d) => {
                        switch (d.replace(/[^/]/g, "").length) {
                            case 2:
                                return 'italic';
                            default:
                                return 'normal'
                        }
                    })

                // .attr('class', d => d.replace(/[0-9]/g, '').replace(/\//g, '').replace(/-/g, '').replace(/ /g, '').replace(/\+/g, '').replace(/\&/g, ''))
            } ,500)

            // setTimeout(() => {
            //     ticks
            //         .each(function (d, i, eleme) {
            //             var tick = state.svg.select('.' + d.replace(/[0-9]/g, '').replace(/\//g, '').replace(/-/g, '').replace(/ /g, '').replace(/\+/g, '').replace(/\&/g, '')),
            //                 text = tick.select('text'),
            //                 bBox = text.node().getBBox();
            //             tick.insert('rect', ':first-child')
            //                 .attr('x', bBox.x - 3)
            //                 .attr('y', bBox.y - 3)
            //                 .attr('height', bBox.height + 6)
            //                 .attr('width', bBox.width + 6)
            //                 .style('fill', 'red');
            //         })
            // }, 500)


            // setTimeout(() => {
            //     ticks.selectAll('rect').remove()
            //     ticks.append("rect")
            //         .attr("width", function (d) {
            //
            //             return this.parentElement.getBBox().width
            //         })
            //         .attr("height", function (d) {
            //             return this.parentElement.getBBox().height
            //         })
            //         .attr('transform', function (d) {
            //
            //             return `translate(${-this.parentElement.getBBox().width / 2}, ${-this.parentElement.getBBox().height / 2})`
            //         })
            //         .style("fill", (d) => {
            //             const numberOfTimeSlashApper = d.replace(/[^'ע']/g, "").length;
            //             switch (numberOfTimeSlashApper) {
            //                 case 2:
            //                     return 'rgba(55,55,55,0.6)';
            //                 case 1:
            //                     return 'rgba(55,55,55,0.3)';
            //                 case 0:
            //                     return 'rgba(55,55,55,0.1)'
            //                 default:
            //                     return 'transparent'
            //             }
            //             // if (d.includes(''))
            //             // if (d && state.labelRule && state.labelRule.values && state.labelRule.field && d[state.labelRule.field]) {
            //             //     return state.labelRule.values[state.labelRule.field]
            //             // }
            //             // return 'transparent'
            //         })
            //     ticks.each(function () {
            //         var firstChild = this.parentNode.firstChild;
            //         if (firstChild) {
            //             this.parentNode.insertBefore(this, firstChild);
            //         }
            //     });
            //
            // }, 200)

            // Grp
            const
                minHeight = d3Min(state.grpScale.range(), function (d, i) {
                    return i > 0 ? d - state.grpScale.range()[i - 1] : d * 2;
                });
            fontSize = Math.min(14, minHeight * fontVerticalMargin * Math.sqrt(2));
            maxChars = Math.floor(state.leftMargin / (fontSize / Math.sqrt(2)));


            //

            function reduceLabel(label, maxChars) {
                return label.length <= maxChars ? label : (
                    label.substring(0, maxChars * 2 / 3)
                    + '...'
                    + label.substring(label.length - maxChars / 3, label.length
                    ));
            }


        }


        function renderGroups() {

            let groups = state.graph.selectAll('rect.series-group').data(state.structData, d => d.group);

            groups.exit()
                .transition().duration(state.transDuration)
                .style('stroke-opacity', 0)
                .style('fill-opacity', 0)
                .remove();

            const newGroups = groups.enter().append('rect')
                .attr('class', 'series-group')
                .attr('x', 0)
                .attr('y', 0)
                .attr('height', 0)
                .style('fill', 'transparent')
                .on('mouseover', state.groupTooltip.show)
                .on('mouseout', state.groupTooltip.hide);

            newGroups.append('title')
                .text('click-drag to zoom in');

            groups = groups.merge(newGroups);

            groups.transition().duration(state.transDuration)
                .attr('width', state.graphW)
                .attr('height', function (d) {
                    return state.graphH * d.lines.length / state.nLines;
                })
                .attr('y', function (d) {
                    return state.grpScale(d.group) - state.graphH * d.lines.length / state.nLines / 2;
                });
        }

        function renderTimelines(maxElems) {

            if (maxElems < 0) maxElems = null;

            const hoverEnlargeRatio = .4;

            const dataFilter = (d, i) =>
                (maxElems == null || i < maxElems) &&
                (state.grpScale.domain().indexOf(d.group) + 1 &&
                    d.timeRange[1] >= state.xScale.domain()[0] &&
                    d.timeRange[0] <= state.xScale.domain()[1] &&
                    state.yScale.domain().indexOf(d.group + '+&+' + d.label) + 1);

            state.lineHeight = state.graphH / state.nLines * 0.8;

            let timelines = state.graph.selectAll('rect.series-segment').data(
                state.flatData.filter(dataFilter),
                d => d.group + d.label + d.timeRange[0]
            );

            timelines.exit()
                .transition().duration(state.transDuration)
                .style('fill-opacity', 0)
                .remove();

            const newSegments = timelines.enter().append('rect')
                .attr('class', 'series-segment')
                .attr('rx', 1)
                .attr('ry', 1)
                .attr('x', state.graphW / 2)
                .attr('y', state.graphH / 2)
                .attr('width', 0)
                .attr('height', 0)
                .style('fill', d => state.zColorScale(d.val))
                .style('fill-opacity', 0)
                .on('mouseover.groupTooltip', state.groupTooltip.show)
                .on('mouseout.groupTooltip', state.groupTooltip.hide)
                .on('mouseover.lineTooltip', state.lineTooltip.show)
                .on('mouseout.lineTooltip', state.lineTooltip.hide)
                .on('mouseover.segmentTooltip', state.segmentTooltip.show)
                .on('mouseout.segmentTooltip', state.segmentTooltip.hide);

            newSegments
                .on('mouseover', function () {
                    if ('disableHover' in state && state.disableHover)
                        return;

                    MoveToFront()(this);

                    const hoverEnlarge = state.lineHeight * hoverEnlargeRatio;

                    d3Select(this)
                        .transition().duration(70)
                        .attr('x', function (d) {
                            return state.xScale(d.timeRange[0]) - hoverEnlarge / 2;
                        })
                        .attr('width', function (d) {
                            return d3Max([1, state.xScale(d.timeRange[1]) - state.xScale(d.timeRange[0])]) + hoverEnlarge;
                        })
                        .attr('y', function (d) {
                            return state.yScale(d.group + '+&+' + d.label) - (state.lineHeight + hoverEnlarge) / 2;
                        })
                        .attr('height', state.lineHeight + hoverEnlarge)
                        .style('fill-opacity', 1);
                })
                .on('mouseout', function () {
                    d3Select(this)
                        .transition().duration(250)
                        .attr('x', function (d) {
                            return state.xScale(d.timeRange[0]);
                        })
                        .attr('width', function (d) {
                            return d3Max([1, state.xScale(d.timeRange[1]) - state.xScale(d.timeRange[0])]);
                        })
                        .attr('y', function (d) {
                            return state.yScale(d.group + '+&+' + d.label) - state.lineHeight / 2;
                        })
                        .attr('height', state.lineHeight)
                        .style('fill-opacity', .8);
                });

            timelines = timelines.merge(newSegments);

            timelines.transition().duration(state.transDuration)
                .attr('x', function (d) {
                    return state.xScale(d.timeRange[0]);
                })
                .attr('width', function (d) {
                    return d3Max([1, state.xScale(d.timeRange[1]) - state.xScale(d.timeRange[0])]);
                })
                .attr('y', function (d) {
                    return state.yScale(d.group + '+&+' + d.label) - state.lineHeight / 2;
                })
                .attr('height', state.lineHeight)
                .style('fill-opacity', .8);
        }
    }
});
