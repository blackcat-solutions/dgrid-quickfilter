define([
    "dojo/_base/declare",
    "dojo/_base/array",
    "dojo/_base/lang",
    "dojo/query",
    "dojo/on",
    "dojo/keys",
    "dojo/dom-geometry",
    "dojo/dom-style",
    "put-selector/put",
    "dijit/form/TextBox",
    "dijit/form/ComboBox",
    "dijit/form/NumberTextBox",
    "dijit/form/DateTextBox",
    "dojox/form/TriStateCheckBox",
    "dojo/store/Memory",
    "dijit/registry",
    "dijit/Menu",
    "dijit/MenuItem"
],
function(declare, array, lang, query, on, keys, geometry, style, put, TextBox, ComboBox, NumberTextBox, DateTextBox, TriStateCheckBox,
        Memory, registry, Menu, MenuItem){

    return declare('dgrid-quickfilter._QuickFilterMixin', [], {

        _simpleFilterRootNode: null,
        _simpleFilterKeyPressHandler: null,
        _simpleFilterScrollHandlers: [],
        simpleFilterQuery: {},
        _filterComboBoxes: {},
        _simpleFilterQueryChangeInProgress: false,
        _simpleFilterLastExternalQuery: null,
        _processSimpleFilterChangeEvents: true,
        _simpleFilterMenu: null,

        constructor: function() {
            this._simpleFilterKeyPressHandler = null;
            this.simpleFilterQuery = {};
            this._filterComboBoxes = {};
            this._simpleFilterScrollHandlers = [];
            this._processSimpleFilterChangeEvents = true;
        },

        destroy: function() {
            this.inherited(arguments);
            this._simpleFilterKeyPressHandler.remove();
            array.forEach(this._simpleFilterScrollHandlers, function(handler){
                handler.remove();
            });
        },

        renderHeader: function() {
            this.inherited(arguments);

            var filteredColumns = this._getFilteredColumns();
            if (filteredColumns.length > 0) {
                this._applySimpleColumnFilters();
            }
        },

        applySimpleFilters: function(filters) {
            var self = this, widget;

            // suspend event processing
            this._processSimpleFilterChangeEvents = false;

            array.forEach(filters, function(filter){
                widget = self._getFilterWidget(filter.field);
                if (!widget) {
                    throw new Error('Could not find widget for field: ' + filter.field);
                }
                widget.set('value', filter.value);
            });

            // resume event processing
            this._processSimpleFilterChangeEvents = true;

            // execute query - the query was modded on the change events of the widgets as we set their values
            this.handleSimpleFilterChange(this.simpleFilterQuery);
        },

        /**
         * This simple implementation just overwrites the query in the grid, ensuring that it is mixed in to the
         * last query that was externally set.  Overwrite if you need to do anything more complicated.
         * @param query this is always just the simple filter query.
         */
        handleSimpleFilterChange: function(query) {
            if (this._processSimpleFilterChangeEvents) {
                // if no-one has set an external query yet, simulate an empty one
                if (!this._simpleFilterLastExternalQuery) {
                    this._simpleFilterLastExternalQuery = [];
                }
                var externalQuery = this._simpleFilterLastExternalQuery,
                    combinedQuery = [query];

                array.forEach(externalQuery, function(q){
                    combinedQuery.push(q);
                });

                this._simpleFilterQueryChangeInProgress = true;
                this.set('query', combinedQuery);
                this._simpleFilterQueryChangeInProgress = false;
            }
        },

        clearSimpleFilters: function() {
            var self = this,
                doOneColumnSet = function(columnSet) {
                    array.forEach(columnSet, function(rowSet){
                        array.forEach(rowSet, function(column){
                            var filterConfig = column.filterConfig;
                            if (filterConfig) {
                                self._clearSimpleFilterWidget(filterConfig._simpleFilterWidget);
                            }
                        });
                    });
                };

            // suspend event processing
            this._processSimpleFilterChangeEvents = false;

            // go through each widget and set value appropriately
            if (this.columnSets) {
                array.forEach(this.columnSets, doOneColumnSet);
            }
            else {
                doOneColumnSet(this.columns);
            }

            // resume event processing
            this._processSimpleFilterChangeEvents = true;

            // execute query - the query was modded on the change events of the widgets as we set their values
            this.handleSimpleFilterChange(this.simpleFilterQuery);
        },

        set: function(property, value) {
            if (property === 'query') {
                /*
                 * If we are setting the query as a result of internal
                 * simple filter changes, then the last external base query
                 * has already been mixed in with the simple filter query
                 * to form a correct overall query (see handleSimpleFilterChange).
                 *
                 * Otherwise, it is someone setting the external query, which is the only
                 * case we need to deal with here.
                 */
                if (!this._simpleFilterQueryChangeInProgress) {
                    // someone is setting the query externally
                    // if it is not an array, make it one
                    if (!(value instanceof Array)) {
                        value = value ? [value] : [];
                    }
                    this._simpleFilterLastExternalQuery = value;
                    // and now if the simple filter query is specified, add it in there
                    if (this.simpleFilterQuery) {
                        value.push(this.simpleFilterQuery);
                    }
                }
            }
            this.inherited(arguments);
            if (property === 'store') {
                this._populateComboBoxes(value);
                // enable / disable the widgets
                array.forEach(registry.findWidgets(this._simpleFilterRootNode), function(widget){
                    if (value) {
                        widget.set('disabled', false);
                        widget.set('readOnly', false);
                    }
                    else {
                        widget.set('disabled', true);
                        widget.set('readOnly', true);
                    }
                });
            }
        },

        _applySimpleColumnFilters: function() {

            var headerDivs = query('div.dgrid-header', this.domNode)[0].childNodes,
                headerDiv = headerDivs[headerDivs.length - 1],
                newHeader, tr, colsettables = [], greatestHeight = 0;

            if (!this._simpleFilterMenu) {
                this._simpleFilterMenu = new Menu();
                this._simpleFilterMenu.addChild(new MenuItem({
                    label: 'Clear this filter',
                    onClick: lang.hitch(this, this._clearThisSimpleFilter)
                }));
                this._simpleFilterMenu.addChild(new MenuItem({
                    label: 'Clear all filters',
                    onClick: lang.hitch(this, this._clearAllSimpleFilters)
                }));
            }

            // it's either regular columns, or column sets
            if (this.columnSets) {
                newHeader = put('table.dgrid-row-table.simple-filter#$', this.id + '-filter-row');

                put(headerDiv, '+', newHeader); // put it below the existing one
                // add the tbody and tr to it
                tr = put(newHeader, 'tbody tr');

                array.forEach(this.columnSets, lang.hitch(this, function(columnSet, index){
                    var colsettable = put(tr, 'th.dgrid-column-set-cell.dgrid-column-set-' + index + '[role=columnheader] div.dgrid-column-set[colsetid='
                        + index + '] table.dgrid-row-table[role=presentation]'),
                        trinfo, scrollingDiv;

                    colsettables.push(colsettable);

                    this._renderColumnFilters(columnSet, colsettable);

                    trinfo = geometry.position(colsettable);
                    if (trinfo.h > greatestHeight) {
                        greatestHeight = trinfo.h;
                    }

                    scrollingDiv = query('div.dgrid-column-set[colsetid=' + index + ']', newHeader)[0];
                    this._simpleFilterScrollHandlers.push(on(scrollingDiv, 'scroll', function(evt){
                        // if the scrollLeft is not equal to the scrollLeft of the column set scroll, change
                        // the column set scroller's scrollLeft so that everything scrolls along (this will be
                        // due to the user tabbing through filter fields)
                        var colsetScroller = query('div.dgrid-column-set-scroller[colsetid=' + index + ']', this.domNode)[0];
                        if (scrollingDiv.scrollLeft !== colsetScroller.scrollLeft) {
                            colsetScroller.scrollLeft = scrollingDiv.scrollLeft;
                        }
                    }));
                }));

                // ensure the rows in each col set are the same height
                array.forEach(colsettables, function(colsettable){
                    style.set(colsettable, 'height', greatestHeight + 'px');
                });

            }
            else if (this.columns) {
                newHeader = put('table.dgrid-row-table[role=presentation]');
                put(headerDiv, '+', newHeader); // put it below the existing one
                this._renderColumnFilters(this.columns, newHeader);
            }

            this._simpleFilterKeyPressHandler = on(newHeader, 'keypress', lang.hitch(this, function(evt){
                if (evt.keyCode === keys.ENTER) {
                    this.handleSimpleFilterChange(this.simpleFilterQuery);
                }
            }));

            this._simpleFilterRootNode = newHeader;
        },

        _renderColumnFilters: function(columnSet, parent) {
            var self = this;
            array.forEach(columnSet, function(rowSet){
                array.forEach(rowSet, function(column){
                    var th, widget, filterConfig, widgetArgs;
                    th = put(parent, 'td.dgrid-cell.field-' + column.field);
                    if (column.filterConfig) {
                        filterConfig = column.filterConfig;
                        if (!filterConfig.filterField) {
                            filterConfig.filterField = column.field;
                        }
                        widgetArgs = filterConfig.widgetArgs || {};

                        // they all start off disabled
                        widgetArgs.disabled = true;

                        if (filterConfig.type === 'textbox') {
                            widgetArgs.onKeyPress = function(){
                                if (widget.get('value')) {
                                    self.simpleFilterQuery[filterConfig.filterField] = new RegExp('^.*' + widget.get('value') + '.*', 'i');
                                }
                                else {
                                    delete self.simpleFilterQuery[filterConfig.filterField];
                                }
                            };
                            widgetArgs.onChange = function(value){
                                if (value) {
                                    self.simpleFilterQuery[filterConfig.filterField] = new RegExp('^.*' + value + '.*', 'i');
                                }
                                else {
                                    delete self.simpleFilterQuery[filterConfig.filterField];
                                }
                                self.handleSimpleFilterChange(self.simpleFilterQuery);
                            };
                            widget = new TextBox(widgetArgs);
                        }

                        else if (filterConfig.type === 'numbertextbox') {
                            widgetArgs.onKeyPress = function(){
                                if (widget.get('value')) {
                                    self.simpleFilterQuery[filterConfig.filterField] = widget.get('value');
                                }
                                else {
                                    delete self.simpleFilterQuery[filterConfig.filterField];
                                }
                            };
                            widgetArgs.onChange = function(value){
                                if (value) {
                                    self.simpleFilterQuery[filterConfig.filterField] = value;
                                }
                                else {
                                    delete self.simpleFilterQuery[filterConfig.filterField];
                                }
                                self.handleSimpleFilterChange(self.simpleFilterQuery);
                            };
                            widget = new NumberTextBox(widgetArgs);
                        }

                        else if (filterConfig.type === 'datetextbox') {
                            widgetArgs.onChange = function(value){
                                if (value) {
                                    self.simpleFilterQuery[filterConfig.filterField] = value;
                                }
                                else {
                                    delete self.simpleFilterQuery[filterConfig.filterField];
                                }
                                self.handleSimpleFilterChange(self.simpleFilterQuery);
                            };

                            widgetArgs.onKeyPress = function() {
                                if (widget.get('value')) {
                                    self.simpleFilterQuery[filterConfig.filterField] = widget.get('value');
                                }
                                else {
                                    delete self.simpleFilterQuery[filterConfig.filterField];
                                }
                            };

                            widget = new DateTextBox(widgetArgs);
                        }

                        else if (filterConfig.type === 'combo') {
                            widget = self._makeComboBox(filterConfig.filterField, widgetArgs);
                        }

                        else if (filterConfig.type === 'checkbox') {

                            if (!widgetArgs.states) {
                                widgetArgs.states = ["mixed", true, false];
                            }

                            widgetArgs.onChange = function(value) {
                                if (value === 'mixed') {
                                    delete self.simpleFilterQuery[filterConfig.filterField];
                                }
                                else {
                                    if (filterConfig.checkboxValues.hasOwnProperty(value)) {
                                        value = filterConfig.checkboxValues[value];
                                    }
                                    self.simpleFilterQuery[filterConfig.filterField] = value;
                                }
                                self.handleSimpleFilterChange(self.simpleFilterQuery);
                            };

                            widget = new TriStateCheckBox(widgetArgs);
                            widget.set('value', 'mixed'); // only seems to render properly if do it here
                        }

                        self._simpleFilterMenu.bindDomNode(widget.domNode);

                        // ensure we know which field was cleared last
                        widget.on('focus', function(){
                            self._focusedSimpleFilterField = widget;
                        });

                        filterConfig._simpleFilterWidget = widget;

                        th.appendChild(widget.domNode);
                    }
                });
            });
        },

        _makeComboBox: function(field, widgetArgs) {
            var self = this, ret;
            widgetArgs.store = new Memory({data: []});

            widgetArgs.onChange = function(value) {
                if (value) {
                    self.simpleFilterQuery[field] = new RegExp('.*^' + value + '.*', 'i');
                }
                else {
                    delete self.simpleFilterQuery[field];
                }
                self.handleSimpleFilterChange(self.simpleFilterQuery);
            };

            widgetArgs.onKeyPress = function(value) {
                if (ret.get('value')) {
                    self.simpleFilterQuery[field] = new RegExp('^.*' + ret.get('value') + '.*', 'i');
                }
                else {
                    delete self.simpleFilterQuery[field];
                }
            };

            ret = new ComboBox(widgetArgs);
            this._filterComboBoxes[field] = ret;
            return ret;
        },

        _populateComboBoxes: function(store) {
            var property, combo, values, data,

                populateValues = function(item){
                    var value = item[property];
                    if (array.indexOf(values, value) === -1) {
                        values.push(value);
                    }
                },

                populateData = function(value){
                    data.push({name: value});
                };

            for (property in this._filterComboBoxes) {
                if (this._filterComboBoxes.hasOwnProperty(property)) {
                    values = [];
                    data = [];
                    if (this._filterComboBoxes.hasOwnProperty(property)) {
                        combo = this._filterComboBoxes[property];
                        if (store) {
                            store.query(null).forEach(populateValues);
                            values.sort();
                            array.forEach(values, populateData);
                            combo.set('store', new Memory({
                                data: data
                            }));
                        }
                        else {
                            combo.set('store', new Memory({
                                data: []
                            }));
                        }
                    }
                }
            }
        },

        _getFilteredColumns: function() {
            var ret = [], key, col;
            for (key in this.columns) {
                if (this.columns.hasOwnProperty(key)) {
                    col = this.columns[key];
                    if (col.filterConfig) {
                        ret.push(col);
                    }
                }
            }
            return ret;
        },

        _getFilterWidget: function(fieldName) {
            var ret = null,
                self = this,
                doOneColumnSet = function(columnSet) {
                    array.forEach(columnSet, function(rowSet){
                        array.forEach(rowSet, function(column){
                            if (ret === null && column.filterConfig && self._getFilterField(column) === fieldName) {
                                ret = column.filterConfig._simpleFilterWidget;
                            }
                        });
                    });
                };

            if (this.columnSets) {
                array.forEach(this.columnSets, doOneColumnSet);
            }
            else {
                doOneColumnSet(this.columns);
            }

            return ret;
        },

        _getFilterField: function(column) {
            if (column.filterConfig && column.filterConfig.filterField) {
                return column.filterConfig.filterField;
            }
            else {
                return column.field;
            }
        },

        _clearThisSimpleFilter: function() {
            this._clearSimpleFilterWidget(this._focusedSimpleFilterField);
        },

        _clearAllSimpleFilters: function() {
            this.clearSimpleFilters();
        },

        _clearSimpleFilterWidget: function(widget) {
            if (widget instanceof TextBox) {
                widget.set('value', null);
            }
            else if (widget instanceof TriStateCheckBox) {
                widget.set('value', 'mixed');
            }
        }

    });

});