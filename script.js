/**
 * DashboardEditor - Main class for managing the dashboard layout editor
 * Handles widget placement, drag-and-drop, layout calculations, and rendering
 */
class DashboardEditor {
    constructor() {
        // Main canvas element where the dashboard is rendered
        this.gridCanvas = document.getElementById('grid-canvas');
        
        // Array of sections (each section contains widgets or a filter group)
        this.sections = [];
        
        // Drag and drop state management
        this.draggedElement = null;        // Currently dragged DOM element
        this.draggedWidget = null;         // Widget object being dragged
        this.draggedSection = null;        // Section being dragged
        this.isDraggingFromPanel = false;  // True when dragging from the widget panel
        this.draggedWidgetSize = null;     // Size of widget being dragged from panel
        this.dragPlaceholder = null;       // Visual placeholder shown during drag
        
        // ID counters for generating unique IDs
        this.widgetIdCounter = 0;
        this.sectionIdCounter = 0;
        this.filterGroupIdCounter = 0;
        
        // Widget size definitions (minimum heights in rem)
        this.TOKENS = {
            minHeightsRem: {
                XS: 10,
                S: 16,
                M: 22,
                L: 32,
                XL: 46
            }
        };
        
        // Layout configuration for widget sections
        this.layoutConfig = {
            maxRailItems: 4,      // Max widgets in RowBlock rail
            toleranceRem: 2,      // Height tolerance for rail matching
            vGapRem: 0.75,        // Vertical gap in rail (rem)
            columnGap: 12,        // Gap between columns (px)
            rowGap: 12,           // Gap between rows (px)
            sectionGap: 20,       // Gap between sections (px)
            paddingX: 20          // Horizontal padding (px)
        };
        
        // Configuration for filter group sections
        this.filterGroupConfig = {
            minItemWidthPx: 280,      // Minimum widget width in filter groups
            gapPx: 12,                // Gap between widgets
            alignHeightsInRow: true   // Align heights in same row
        };
        
        // Resize observer to handle window resizing
        this.resizeObserver = null;
        
        // Initialize the editor
        this.init();
    }
    
    /**
     * Generate a unique widget ID
     * @returns {string} Widget ID in format 'w_N'
     */
    newWidgetId() {
        return 'w_' + this.widgetIdCounter++;
    }
    
    /**
     * Generate a unique section ID
     * @returns {string} Section ID in format 's_N'
     */
    newSectionId() {
        return 's_' + this.sectionIdCounter++;
    }
    
    /**
     * Generate a unique filter group ID
     * @returns {string} Filter group ID in format 'fg_N'
     */
    newFilterGroupId() {
        return 'fg_' + this.filterGroupIdCounter++;
    }
    
    /**
     * Create a new filter group object
     * @param {string} title - Title for the filter group
     * @returns {object} Filter group configuration object
     */
    createFilterGroup(title = 'Filter Container') {
        return {
            id: this.newFilterGroupId(),
            title: title,
            filters: [],    // Array of filter chips
            widgets: [],    // Array of widgets in this filter group
            layout: {
                minItemWidthPx: this.filterGroupConfig.minItemWidthPx,
                gapPx: this.filterGroupConfig.gapPx,
                alignHeightsInRow: this.filterGroupConfig.alignHeightsInRow
            }
        };
    }
    
    /**
     * Add a filter chip to a filter group
     * @param {string} groupId - ID of the filter group
     */
    addFilterToGroup(groupId) {
        const section = this.sections.find(s => s.type === 'filter-group' && s.group.id === groupId);
        if (section) {
            section.group.filters.push({
                id: `filter_${Date.now()}`,
                label: 'Filter'
            });
            this.render();
        }
    }
    
    /**
     * Remove a filter chip from a filter group
     * @param {string} groupId - ID of the filter group
     * @param {string} filterId - ID of the filter to remove
     */
    removeFilterFromGroup(groupId, filterId) {
        const section = this.sections.find(s => s.type === 'filter-group' && s.group.id === groupId);
        if (section) {
            section.group.filters = section.group.filters.filter(f => f.id !== filterId);
            this.render();
        }
    }
    
    /**
     * Initialize the dashboard editor
     * Sets up event handlers and loads initial state
     */
    init() {
        this.setupPanelDragHandlers();   // Setup drag from widget panel
        this.setupGridDropHandlers();    // Setup drop zones in canvas
        this.setupResizeObserver();      // Watch for canvas resize
        this.loadInitialState();         // Load initial dashboard state
    }
    
    /**
     * Setup resize observer to re-render dashboard when canvas size changes
     */
    setupResizeObserver() {
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                this.render();  // Re-render on resize
            }
        });
        
        this.resizeObserver.observe(this.gridCanvas);
    }
    
    /**
     * Calculate number of columns based on container width (responsive breakpoints)
     * @param {number} containerWidth - Width of the container in pixels
     * @returns {number} Number of columns (1-4)
     */
    getColCountFromWidth(containerWidth) {
        if (containerWidth >= 1200) return 4;  // Desktop: 4 columns
        if (containerWidth >= 900) return 3;   // Tablet landscape: 3 columns
        if (containerWidth >= 600) return 2;   // Tablet portrait: 2 columns
        return 1;                              // Mobile: 1 column
    }
    
    /**
     * Get the effective span of a widget (capped by column count)
     * @param {object} widget - Widget object
     * @param {number} colCount - Total number of columns
     * @returns {number} Effective span (1 to colCount)
     */
    effectiveSpan(widget, colCount) {
        return Math.min(widget.minColSpan, colCount);
    }
    
    /**
     * Check if an item is a RowBlock (special layout with main + rail)
     * @param {object} item - Item to check
     * @returns {boolean} True if item is a RowBlock
     */
    isRowBlock(item) {
        return item.kind === 'rowblock';
    }
    
    /**
     * Get the span of an item (RowBlocks always take full width)
     * @param {object} item - Widget or RowBlock
     * @param {number} colCount - Total number of columns
     * @returns {number} Span in columns
     */
    itemSpan(item, colCount) {
        if (this.isRowBlock(item)) return colCount;  // RowBlocks take full width
        return this.effectiveSpan(item, colCount);
    }
    
    /**
     * Transform widgets into RowBlocks where applicable
     * A RowBlock is a special layout: 3-col main widget + 1-col rail of smaller widgets
     * Only applies when colCount is 4 (desktop layout)
     * @param {array} widgetsInOrder - Array of widgets in order
     * @param {number} colCount - Total number of columns
     * @returns {array} Array of widgets and RowBlocks
     */
    transformRowBlocks(widgetsInOrder, colCount) {
        // RowBlocks only work in 4-column layout
        if (colCount !== 4) return [...widgetsInOrder];
        
        const items = [...widgetsInOrder];
        const { maxRailItems, toleranceRem, vGapRem } = this.layoutConfig;
        
        let i = 0;
        while (i < items.length) {
            const current = items[i];
            if (this.isRowBlock(current)) { 
                i++; 
                continue; 
            }
            
            const w = current;
            if (this.effectiveSpan(w, colCount) !== 3) { 
                i++; 
                continue; 
            }
            
            const rb = { 
                kind: 'rowblock', 
                main: w, 
                rail: [],
                id: `rb-${w.id}`
            };
            
            const railTarget = w.minHeightRem + toleranceRem;
            let railHeight = 0;
            let railCount = 0;
            
            const canTake = (candidate) => {
                if (railCount >= maxRailItems) return false;
                if (this.effectiveSpan(candidate, colCount) !== 1) return false;
                const addGap = railCount > 0 ? vGapRem : 0;
                return (railHeight + addGap + candidate.minHeightRem) <= railTarget;
            };
            
            let k = i - 1;
            const capturedPrev = [];
            while (k >= 0) {
                const prev = items[k];
                if (this.isRowBlock(prev)) break;
                const pw = prev;
                if (this.effectiveSpan(pw, colCount) !== 1) break;
                if (!canTake(pw)) break;
                
                capturedPrev.push(pw);
                const addGap = railCount > 0 ? vGapRem : 0;
                railHeight += addGap + pw.minHeightRem;
                railCount++;
                
                k--;
            }
            
            let capturedNext = [];
            if (capturedPrev.length === 0) {
                let j = i + 1;
                while (j < items.length) {
                    const next = items[j];
                    if (this.isRowBlock(next)) break;
                    if (this.effectiveSpan(next, colCount) !== 1) break;
                    if (!canTake(next)) break;
                    
                    capturedNext.push(next);
                    const addGap = railCount > 0 ? vGapRem : 0;
                    railHeight += addGap + next.minHeightRem;
                    railCount++;
                    j++;
                }
                
                if (capturedNext.length > 0) {
                    items.splice(i + 1, capturedNext.length);
                }
            }
            
            rb.rail.push(...capturedPrev.reverse(), ...capturedNext);
            
            if (rb.rail.length > 0) {
                if (capturedPrev.length > 0) {
                    const startPrev = k + 1;
                    const countPrev = i - startPrev;
                    if (countPrev > 0) {
                        items.splice(startPrev, countPrev);
                        i = startPrev;
                    }
                }
                
                items.splice(i, 1, rb);
            }
            
            i++;
        }
        
        return items;
    }
    
    /**
     * Pack widgets/RowBlocks into rows with intelligent distribution
     * - Fills rows left to right until colCount is reached
     * - Expands widgets to fill remaining space when possible
     * - Marks rows for equal distribution when all widgets are 1-col
     * @param {array} items - Array of widgets or RowBlocks
     * @param {number} colCount - Total columns available
     * @returns {array} Array of row objects with cells
     */
    packRows(items, colCount) {
        console.log(`\n=== packRows: colCount = ${colCount} ===`);
        const rows = [];
        let currentRow = [];
        let used = 0;
        
        const flush = () => {
            if (currentRow.length === 0) return;
            
            console.log(`\nFlushing row: used = ${used}, colCount = ${colCount}`);
            console.log('Current row before expansion:', currentRow.map(c => ({
                type: this.isRowBlock(c.item) ? 'RowBlock' : c.item.size,
                span: c.span
            })));
            
            const remaining = colCount - used;
            console.log(`Remaining space: ${remaining}`);
            
            if (remaining > 0) {
                const expandableWidgets = currentRow.filter(cell => !this.isRowBlock(cell.item));
                console.log(`Expandable widgets: ${expandableWidgets.length}`);
                
                if (expandableWidgets.length > 0) {
                    const allAreMinSpan = expandableWidgets.every(cell => cell.span === 1);
                    
                    if (allAreMinSpan && remaining < expandableWidgets.length) {
                        console.log('All widgets are 1-col and remaining space is less than widget count, distributing equitably without expansion');
                        currentRow.forEach(cell => {
                            cell.distributeEqually = true;
                        });
                    } else {
                        const extraPerWidget = Math.floor(remaining / expandableWidgets.length);
                        let leftover = remaining % expandableWidgets.length;
                        console.log(`Extra per widget: ${extraPerWidget}, leftover: ${leftover}`);
                        
                        expandableWidgets.forEach((cell, idx) => {
                            const extra = extraPerWidget + (idx < leftover ? 1 : 0);
                            const oldSpan = cell.span;
                            cell.span = Math.min(colCount, cell.span + extra);
                            console.log(`  Widget ${idx}: ${oldSpan} → ${cell.span} (extra: ${extra})`);
                        });
                    }
                }
            }
            
            console.log('Current row after expansion:', currentRow.map(c => ({
                type: this.isRowBlock(c.item) ? 'RowBlock' : c.item.size,
                span: c.span
            })));
            const totalSpan = currentRow.reduce((sum, c) => sum + c.span, 0);
            console.log(`Total span: ${totalSpan} / ${colCount}`);
            
            rows.push({ cells: currentRow });
            currentRow = [];
            used = 0;
        };
        
        for (const item of items) {
            const span = this.itemSpan(item, colCount);
            const itemType = this.isRowBlock(item) ? 'RowBlock' : item.size;
            console.log(`Processing ${itemType}: span = ${span}, used = ${used}`);
            
            if (span >= colCount) {
                console.log(`  → Full width item, creating separate row`);
                flush();
                rows.push({ cells: [{ item, span: colCount }] });
                continue;
            }
            
            if (used + span > colCount) {
                console.log(`  → Would exceed colCount (${used} + ${span} > ${colCount}), flushing current row`);
                flush();
            }
            
            console.log(`  → Adding to current row`);
            currentRow.push({ item, span });
            used += span;
        }
        
        flush();
        return rows;
    }
    
    layoutSection(section, containerWidth) {
        const colCount = this.getColCountFromWidth(containerWidth);
        console.log(`\n=== layoutSection: containerWidth = ${containerWidth}, colCount = ${colCount} ===`);
        
        if (section.type === 'filter-group') {
            console.log('Filter group widgets:', section.group.widgets.map(w => w.size));
            
            const items = this.transformRowBlocks(section.group.widgets, colCount);
            console.log('Filter group items before packRows:', items.map(item => 
                this.isRowBlock(item) ? 'RowBlock' : item.size
            ));
            const rows = this.packRows(items, colCount);
            
            return {
                type: 'filter-group',
                group: section.group,
                colCount,
                rows,
                containerWidth
            };
        }
        
        console.log('Section widgets:', section.widgets.map(w => w.size));
        const items = this.transformRowBlocks(section.widgets, colCount);
        console.log('Items before packRows:', items.map(item => 
            this.isRowBlock(item) ? 'RowBlock' : item.size
        ));
        const rows = this.packRows(items, colCount);
        
        return {
            type: 'widget',
            colCount,
            rows
        };
    }
    
    /**
     * Setup drag handlers for widget panel items
     * Handles:
     * - Drag start: Store widget size and create placeholder
     * - Drag end: Clean up state
     * - Add button click: Add widget to last section
     */
    setupPanelDragHandlers() {
        const widgetItems = document.querySelectorAll('.widget-item');
        
        widgetItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                this.isDraggingFromPanel = true;
                const widgetSize = item.dataset.size;
                this.draggedWidgetSize = widgetSize;
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('widgetSize', widgetSize);
                this.createDragPlaceholder();
            });
            
            item.addEventListener('dragend', () => {
                this.isDraggingFromPanel = false;
                this.draggedWidgetSize = null;
                this.removeDragPlaceholder();
            });
            
            const addBtn = item.querySelector('.widget-item-add-btn');
            if (addBtn) {
                addBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const widgetSize = item.dataset.size;
                    this.addWidgetToLastSection(widgetSize);
                });
            }
        });
    }
    
    addWidgetToLastSection(widgetSize) {
        if (widgetSize === 'FILTER') {
            const filterGroup = this.createFilterGroup('Filter Container');
            const newSection = {
                id: this.newSectionId(),
                type: 'filter-group',
                group: filterGroup
            };
            this.sections.push(newSection);
            this.render();
            // Scroll to the new filter container section
            this.scrollToSection(newSection.id);
            return;
        }
        
        const config = this.getWidgetConfig(widgetSize);
        const widget = {
            id: this.newWidgetId(),
            size: widgetSize,
            title: config.displayName,
            minColSpan: config.minColSpan,
            minHeightRem: config.minHeightRem,
            heightMode: config.heightMode
        };
        
        const containerWidth = this.gridCanvas.offsetWidth;
        const colCount = this.getColCountFromWidth(containerWidth);
        
        const lastSection = this.sections.length > 0 ? this.sections[this.sections.length - 1] : null;
        
        if (!lastSection || lastSection.type === 'filter-group') {
            const newSection = {
                id: this.newSectionId(),
                type: 'widget',
                title: 'New Section',
                widgets: [widget]
            };
            this.sections.push(newSection);
            this.render();
            // Scroll to the newly added widget
            this.scrollToWidget(widget.id);
            return;
        }
        
        const testWidgets = [...lastSection.widgets, widget];
        const items = this.transformRowBlocks(testWidgets, colCount);
        const rows = this.packRows(items, colCount);
        
        const lastRow = rows[rows.length - 1];
        const lastRowUsedCols = lastRow.cells.reduce((sum, cell) => sum + cell.span, 0);
        
        if (lastRowUsedCols <= colCount) {
            lastSection.widgets.push(widget);
        } else {
            const newSection = {
                id: this.newSectionId(),
                type: 'widget',
                title: 'New Section',
                widgets: [widget]
            };
            this.sections.push(newSection);
        }
        
        this.render();
        // Scroll to the newly added widget
        this.scrollToWidget(widget.id);
    }
    
    /**
     * Setup drop handlers for the main canvas
     * Handles:
     * - Dragover: Show visual placeholder at drop location
     * - Drop: Execute the drop action (add/move widget or section)
     * - Validation: Prevent drops on invalid (red) dropzones
     */
    setupGridDropHandlers() {
        this.gridCanvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = this.isDraggingFromPanel ? 'copy' : 'move';
            
            const targetInfo = this.getDropTarget(e.clientX, e.clientY);
            if (targetInfo) {
                this.updateDragPlaceholder(targetInfo);
            }
        });
        
        this.gridCanvas.addEventListener('drop', (e) => {
            e.preventDefault();
            
            const targetInfo = this.getDropTarget(e.clientX, e.clientY);
            
            if (targetInfo && targetInfo.isInvalid) {
                this.removeDragPlaceholder();
                this.draggedWidget = null;
                this.draggedSection = null;
                this.draggedWidgetSize = null;
                return;
            }
            
            if (this.isDraggingFromPanel) {
                const widgetSize = e.dataTransfer.getData('widgetSize');
                if (targetInfo && widgetSize) {
                    this.handleDropFromPanel(targetInfo, widgetSize);
                }
            } else if (this.draggedWidget) {
                if (targetInfo) {
                    this.handleMoveWidget(targetInfo);
                }
            } else if (this.draggedSection) {
                if (targetInfo && targetInfo.type === 'between-sections') {
                    this.handleMoveSection(targetInfo);
                }
            }
            
            this.removeDragPlaceholder();
            this.draggedWidget = null;
            this.draggedSection = null;
            this.draggedWidgetSize = null;
        });
    }
    
    /**
     * Validate if a widget can fit in a section without creating a new row
     * Used for drag-and-drop validation to show red/blue dropzones
     * @param {string} widgetSize - Size of widget to add (XS, S, M, L, XL, FILTER)
     * @param {string} sectionId - ID of target section
     * @returns {boolean} True if widget fits in existing rows, false if new row needed
     */
    canWidgetFitInSection(widgetSize, sectionId) {
        if (widgetSize === 'FILTER') return false;
        
        const section = this.sections.find(s => s.id === sectionId);
        if (!section || section.type !== 'widget') return true;
        
        if (section.widgets.length === 0) return true;
        
        const config = this.getWidgetConfig(widgetSize);
        if (!config) return true;
        
        const containerWidth = this.gridCanvas.offsetWidth;
        const colCount = this.getColCountFromWidth(containerWidth);
        
        try {
            const itemsBefore = this.transformRowBlocks(section.widgets, colCount);
            const rowsBefore = this.packRows(itemsBefore, colCount);
            const rowCountBefore = rowsBefore.length;
            
            const testWidgets = [...section.widgets, {
                id: 'temp',
                size: widgetSize,
                title: config.displayName,
                minColSpan: config.minColSpan,
                minHeightRem: config.minHeightRem,
                heightMode: config.heightMode
            }];
            
            const itemsAfter = this.transformRowBlocks(testWidgets, colCount);
            const rowsAfter = this.packRows(itemsAfter, colCount);
            const rowCountAfter = rowsAfter.length;
            
            return rowCountAfter === rowCountBefore;
        } catch (e) {
            console.error('Error in canWidgetFitInSection:', e);
            return true;
        }
    }
    
    /**
     * Calculate drop target based on cursor position
     * Creates dropzones for:
     * - within-section: Between/before/after widgets in a section
     * - within-filter-group: Inside filter containers
     * - between-sections: Between sections
     * Validates dropzones and marks invalid ones (red) when widget doesn't fit
     * @param {number} x - Cursor X position
     * @param {number} y - Cursor Y position
     * @returns {object|null} Drop target info or null
     */
    getDropTarget(x, y) {
        const canvasRect = this.gridCanvas.getBoundingClientRect();
        if (x < canvasRect.left || x > canvasRect.right || 
            y < canvasRect.top || y > canvasRect.bottom) {
            return null;
        }
        
        const sectionElements = document.querySelectorAll('[data-section-id]');
        const dropZones = [];
        
        sectionElements.forEach((sectionEl, idx) => {
            const sectionId = sectionEl.dataset.sectionId;
            const rect = sectionEl.getBoundingClientRect();
            
            const section = this.sections.find(s => s.id === sectionId);
            if (!section) return;
            
            if (section.type === 'filter-group') {
                const filterGroupEl = sectionEl.querySelector('.filter-group');
                if (filterGroupEl) {
                    const filterGroupRect = filterGroupEl.getBoundingClientRect();
                    const filterWidgets = filterGroupEl.querySelectorAll('.filter-group-widget');
                    
                    if (filterWidgets.length === 0) {
                        dropZones.push({
                            type: 'within-filter-group',
                            sectionId: sectionId,
                            position: 0,
                            top: filterGroupRect.top,
                            bottom: filterGroupRect.bottom,
                            left: filterGroupRect.left,
                            right: filterGroupRect.right
                        });
                    } else {
                        filterWidgets.forEach((widgetEl, widgetIdx) => {
                            const widgetRect = widgetEl.getBoundingClientRect();
                            const widgetId = widgetEl.dataset.widgetId;
                            
                            dropZones.push({
                                type: 'within-filter-group',
                                sectionId: sectionId,
                                widgetId: widgetId,
                                position: widgetIdx,
                                top: widgetRect.top - 6,
                                bottom: widgetRect.bottom + 6,
                                left: widgetRect.left - 6,
                                right: widgetRect.right + 6
                            });
                            
                            dropZones.push({
                                type: 'within-filter-group',
                                sectionId: sectionId,
                                position: widgetIdx + 1,
                                top: widgetRect.top - 6,
                                bottom: widgetRect.bottom + 6,
                                left: widgetRect.right - 6,
                                right: widgetRect.right + 20
                            });
                        });
                    }
                }
                
                dropZones.push({
                    type: 'between-sections',
                    position: idx,
                    top: rect.top - 15,
                    bottom: rect.top,
                    left: rect.left,
                    right: rect.right
                });
                
                dropZones.push({
                    type: 'between-sections',
                    position: idx + 1,
                    top: rect.bottom,
                    bottom: rect.bottom + 15,
                    left: rect.left,
                    right: rect.right
                });
                
                return;
            }
            
            const widgetIdToIndex = new Map();
            section.widgets.forEach((widget, index) => {
                widgetIdToIndex.set(widget.id, index);
            });
            
            const railElements = sectionEl.querySelectorAll('.rowblock-rail');
            railElements.forEach(railEl => {
                const railRect = railEl.getBoundingClientRect();
                const railWidgets = railEl.querySelectorAll('[data-widget-id]');
                
                if (railWidgets.length === 0) {
                    dropZones.push({
                        type: 'within-section',
                        sectionId: sectionId,
                        position: 0,
                        top: railRect.top,
                        bottom: railRect.bottom,
                        left: railRect.left,
                        right: railRect.right,
                        isRailDropZone: true
                    });
                } else {
                    railWidgets.forEach((widgetEl, railIdx) => {
                        const widgetRect = widgetEl.getBoundingClientRect();
                        const widgetId = widgetEl.dataset.widgetId;
                        const actualIndex = widgetIdToIndex.get(widgetId);
                        
                        if (actualIndex !== undefined) {
                            if (railIdx === 0) {
                                dropZones.push({
                                    type: 'within-section',
                                    sectionId: sectionId,
                                    position: actualIndex,
                                    top: railRect.top,
                                    bottom: widgetRect.top + (widgetRect.height / 2),
                                    left: railRect.left,
                                    right: railRect.right,
                                    isRailDropZone: true
                                });
                            }
                            
                            dropZones.push({
                                type: 'within-section',
                                sectionId: sectionId,
                                position: actualIndex + 1,
                                top: widgetRect.top + (widgetRect.height / 2),
                                bottom: railIdx === railWidgets.length - 1 ? railRect.bottom : widgetRect.bottom + 6,
                                left: railRect.left,
                                right: railRect.right,
                                isRailDropZone: true
                            });
                        }
                    });
                }
            });
            
            const widgetElements = sectionEl.querySelectorAll('[data-widget-id]');
            const positions = [];
            
            widgetElements.forEach(widgetEl => {
                if (widgetEl.classList.contains('dragging')) return;
                if (widgetEl.closest('.rowblock-rail')) return;
                
                const widgetRect = widgetEl.getBoundingClientRect();
                const widgetId = widgetEl.dataset.widgetId;
                
                const actualIndex = widgetIdToIndex.get(widgetId);
                if (actualIndex === undefined) return;
                
                positions.push({
                    id: widgetId,
                    rect: widgetRect,
                    actualIndex: actualIndex
                });
            });
            
            positions.sort((a, b) => {
                if (Math.abs(a.rect.top - b.rect.top) < 10) {
                    return a.rect.left - b.rect.left;
                }
                return a.rect.top - b.rect.top;
            });
            
            for (let j = 0; j < positions.length; j++) {
                const pos = positions[j];
                
                if (j === 0) {
                    dropZones.push({
                        type: 'within-section',
                        sectionId: sectionId,
                        position: pos.actualIndex,
                        top: pos.rect.top - 10,
                        bottom: pos.rect.bottom + 10,
                        left: pos.rect.left - 15,
                        right: pos.rect.left + 15
                    });
                }
                
                dropZones.push({
                    type: 'within-section',
                    sectionId: sectionId,
                    position: pos.actualIndex + 1,
                    top: pos.rect.top - 10,
                    bottom: pos.rect.bottom + 10,
                    left: pos.rect.right - 15,
                    right: pos.rect.right + 15
                });
            }
            
            if (positions.length === 0) {
                dropZones.push({
                    type: 'within-section',
                    sectionId: sectionId,
                    position: 0,
                    top: rect.top,
                    bottom: rect.bottom,
                    left: rect.left,
                    right: rect.right
                });
            }
            
            if (idx === 0) {
                dropZones.push({
                    type: 'between-sections',
                    position: 0,
                    top: rect.top - 60,
                    bottom: rect.top + 5,
                    left: rect.left,
                    right: rect.right
                });
            }
            
            dropZones.push({
                type: 'between-sections',
                position: idx + 1,
                top: rect.bottom - 5,
                bottom: rect.bottom + 60,
                left: rect.left,
                right: rect.right
            });
        });
        
        if (sectionElements.length === 0) {
            dropZones.push({
                type: 'between-sections',
                position: 0,
                top: canvasRect.top + 20,
                bottom: canvasRect.top + 100,
                left: canvasRect.left + 20,
                right: canvasRect.right - 20
            });
        }
        
        let validZones = [];
        let invalidZones = [];
        
        if (this.isDraggingFromPanel && this.draggedWidgetSize) {
            for (let zone of dropZones) {
                if (zone.type === 'within-section' || zone.type === 'within-filter-group') {
                    const canFit = this.canWidgetFitInSection(this.draggedWidgetSize, zone.sectionId);
                    if (canFit) {
                        validZones.push(zone);
                    } else {
                        zone.isInvalid = true;
                        invalidZones.push(zone);
                    }
                } else {
                    validZones.push(zone);
                }
            }
        } else if (this.draggedWidget) {
            for (let zone of dropZones) {
                if (zone.type === 'within-section' || zone.type === 'within-filter-group') {
                    const canFit = this.canWidgetFitInSection(this.draggedWidget.size, zone.sectionId);
                    if (canFit) {
                        validZones.push(zone);
                    } else {
                        zone.isInvalid = true;
                        invalidZones.push(zone);
                    }
                } else {
                    validZones.push(zone);
                }
            }
        } else {
            validZones = dropZones;
        }
        
        for (let zone of validZones) {
            if (x >= zone.left && x <= zone.right && 
                y >= zone.top && y <= zone.bottom) {
                return zone;
            }
        }
        
        for (let zone of invalidZones) {
            if (x >= zone.left && x <= zone.right && 
                y >= zone.top && y <= zone.bottom) {
                return zone;
            }
        }
        
        return null;
    }
    
    getWidgetConfig(size) {
        switch (size) {
            case 'XS':
                return {
                    minColSpan: 1,
                    minHeightRem: this.TOKENS.minHeightsRem.XS,
                    heightMode: 'stretchRow',
                    displayName: 'XS'
                };
            case 'S':
                return {
                    minColSpan: 1,
                    minHeightRem: this.TOKENS.minHeightsRem.S,
                    heightMode: 'stretchRow',
                    displayName: 'S'
                };
            case 'M':
                return {
                    minColSpan: 2,
                    minHeightRem: this.TOKENS.minHeightsRem.M,
                    heightMode: 'stretchRow',
                    displayName: 'M'
                };
            case 'L':
                return {
                    minColSpan: 3,
                    minHeightRem: this.TOKENS.minHeightsRem.L,
                    heightMode: 'stretchRow',
                    displayName: 'L'
                };
            case 'XL_row':
                return {
                    minColSpan: 4,
                    minHeightRem: this.TOKENS.minHeightsRem.XL,
                    heightMode: 'stretchRow',
                    displayName: 'XL (Row)'
                };
            case 'XL_fill':
                return {
                    minColSpan: 4,
                    minHeightRem: this.TOKENS.minHeightsRem.XL,
                    heightMode: 'fillViewport',
                    displayName: 'XL (Fill)'
                };
            default:
                return {
                    minColSpan: 1,
                    minHeightRem: this.TOKENS.minHeightsRem.XS,
                    heightMode: 'stretchRow',
                    displayName: 'XS'
                };
        }
    }
    
    /**
     * Handle drop of a widget from the panel
     * Creates new widget or filter container and adds to target location
     * @param {object} targetInfo - Drop target information
     * @param {string} widgetSize - Size of widget being dropped
     */
    handleDropFromPanel(targetInfo, widgetSize) {
        if (widgetSize === 'FILTER') {
            const filterGroup = this.createFilterGroup('Filter Container');
            const newSection = {
                id: this.newSectionId(),
                type: 'filter-group',
                group: filterGroup
            };
            
            if (targetInfo.type === 'between-sections') {
                this.sections.splice(targetInfo.position, 0, newSection);
            } else {
                this.sections.push(newSection);
            }
            
            this.render();
            return;
        }
        
        const config = this.getWidgetConfig(widgetSize);
        
        const widget = {
            id: this.newWidgetId(),
            size: widgetSize,
            title: config.displayName,
            minColSpan: config.minColSpan,
            minHeightRem: config.minHeightRem,
            heightMode: config.heightMode
        };
        
        if (targetInfo.type === 'within-section') {
            const section = this.sections.find(s => s.id === targetInfo.sectionId);
            if (section) {
                section.widgets.splice(targetInfo.position, 0, widget);
            }
        } else if (targetInfo.type === 'within-filter-group') {
            const section = this.sections.find(s => s.id === targetInfo.sectionId);
            if (section && section.type === 'filter-group') {
                section.group.widgets.splice(targetInfo.position, 0, widget);
            }
        } else if (targetInfo.type === 'between-sections') {
            const newSection = {
                id: this.newSectionId(),
                type: 'widget',
                title: 'New Section',
                widgets: [widget]
            };
            this.sections.splice(targetInfo.position, 0, newSection);
        }
        
        this.render();
    }
    
    handleMoveWidget(targetInfo) {
        const widget = this.draggedWidget;
        
        let sourceSection = this.sections.find(s => 
            s.type === 'widget' && s.widgets.some(w => w.id === widget.id)
        );
        
        if (!sourceSection) {
            sourceSection = this.sections.find(s => 
                s.type === 'filter-group' && s.group.widgets.some(w => w.id === widget.id)
            );
        }
        
        if (!sourceSection) return;
        
        if (targetInfo.type === 'within-section') {
            const targetSection = this.sections.find(s => s.id === targetInfo.sectionId);
            if (!targetSection || targetSection.type !== 'widget') return;
            
            if (sourceSection.type === 'widget') {
                if (sourceSection.id === targetSection.id) {
                    const currentIndex = sourceSection.widgets.findIndex(w => w.id === widget.id);
                    let newPosition = targetInfo.position;
                    
                    if (newPosition > currentIndex) {
                        newPosition--;
                    }
                    
                    if (currentIndex !== newPosition) {
                        sourceSection.widgets.splice(currentIndex, 1);
                        sourceSection.widgets.splice(newPosition, 0, widget);
                    }
                } else {
                    const currentIndex = sourceSection.widgets.findIndex(w => w.id === widget.id);
                    sourceSection.widgets.splice(currentIndex, 1);
                    targetSection.widgets.splice(targetInfo.position, 0, widget);
                    
                    if (sourceSection.widgets.length === 0) {
                        this.sections = this.sections.filter(s => s.id !== sourceSection.id);
                    }
                }
            } else if (sourceSection.type === 'filter-group') {
                const currentIndex = sourceSection.group.widgets.findIndex(w => w.id === widget.id);
                sourceSection.group.widgets.splice(currentIndex, 1);
                targetSection.widgets.splice(targetInfo.position, 0, widget);
            }
        } else if (targetInfo.type === 'within-filter-group') {
            const targetSection = this.sections.find(s => s.id === targetInfo.sectionId);
            if (!targetSection || targetSection.type !== 'filter-group') return;
            
            if (sourceSection.type === 'widget') {
                const currentIndex = sourceSection.widgets.findIndex(w => w.id === widget.id);
                sourceSection.widgets.splice(currentIndex, 1);
                targetSection.group.widgets.splice(targetInfo.position, 0, widget);
                
                if (sourceSection.widgets.length === 0) {
                    this.sections = this.sections.filter(s => s.id !== sourceSection.id);
                }
            } else if (sourceSection.type === 'filter-group') {
                if (sourceSection.id === targetSection.id) {
                    const currentIndex = sourceSection.group.widgets.findIndex(w => w.id === widget.id);
                    let newPosition = targetInfo.position;
                    
                    if (newPosition > currentIndex) {
                        newPosition--;
                    }
                    
                    if (currentIndex !== newPosition) {
                        sourceSection.group.widgets.splice(currentIndex, 1);
                        sourceSection.group.widgets.splice(newPosition, 0, widget);
                    }
                } else {
                    const currentIndex = sourceSection.group.widgets.findIndex(w => w.id === widget.id);
                    sourceSection.group.widgets.splice(currentIndex, 1);
                    targetSection.group.widgets.splice(targetInfo.position, 0, widget);
                }
            }
        } else if (targetInfo.type === 'between-sections') {
            if (sourceSection.type === 'widget') {
                const currentIndex = sourceSection.widgets.findIndex(w => w.id === widget.id);
                sourceSection.widgets.splice(currentIndex, 1);
            } else if (sourceSection.type === 'filter-group') {
                const currentIndex = sourceSection.group.widgets.findIndex(w => w.id === widget.id);
                sourceSection.group.widgets.splice(currentIndex, 1);
            }
            
            const newSection = {
                id: this.newSectionId(),
                type: 'widget',
                title: 'New Section',
                widgets: [widget]
            };
            
            this.sections.splice(targetInfo.position, 0, newSection);
            
            if (sourceSection.type === 'widget' && sourceSection.widgets.length === 0) {
                this.sections = this.sections.filter(s => s.id !== sourceSection.id);
            }
        }
        
        this.render();
    }
    
    handleMoveSection(targetInfo) {
        const section = this.draggedSection;
        const currentIndex = this.sections.findIndex(s => s.id === section.id);
        
        let newPosition = targetInfo.position;
        if (newPosition > currentIndex) {
            newPosition--;
        }
        
        if (currentIndex !== newPosition) {
            this.sections.splice(currentIndex, 1);
            this.sections.splice(newPosition, 0, section);
        }
        
        this.render();
    }
    
    deleteWidget(widgetId) {
        for (let section of this.sections) {
            if (section.type === 'widget') {
                const index = section.widgets.findIndex(w => w.id === widgetId);
                if (index !== -1) {
                    section.widgets.splice(index, 1);
                    
                    if (section.widgets.length === 0) {
                        this.sections = this.sections.filter(s => s.id !== section.id);
                    }
                    
                    break;
                }
            } else if (section.type === 'filter-group') {
                const index = section.group.widgets.findIndex(w => w.id === widgetId);
                if (index !== -1) {
                    section.group.widgets.splice(index, 1);
                    break;
                }
            }
        }
        this.render();
    }
    
    moveWidgetToFilterContainer(widgetId) {
        let widget = null;
        let sourceSectionIndex = -1;
        
        for (let i = 0; i < this.sections.length; i++) {
            const section = this.sections[i];
            if (section.type === 'widget') {
                const widgetIndex = section.widgets.findIndex(w => w.id === widgetId);
                if (widgetIndex !== -1) {
                    widget = section.widgets[widgetIndex];
                    section.widgets.splice(widgetIndex, 1);
                    sourceSectionIndex = i;
                    
                    if (section.widgets.length === 0) {
                        this.sections.splice(i, 1);
                        sourceSectionIndex = i;
                    }
                    
                    break;
                }
            }
        }
        
        if (!widget) return;
        
        const filterGroup = this.createFilterGroup('Filter Container');
        const filterContainer = {
            id: this.newSectionId(),
            type: 'filter-group',
            group: filterGroup
        };
        
        filterContainer.group.widgets.push(widget);
        this.sections.splice(sourceSectionIndex, 0, filterContainer);
        
        this.render();
    }
    
    deleteSection(sectionId) {
        this.sections = this.sections.filter(s => s.id !== sectionId);
        this.render();
    }
    
    /**
     * Scroll to a specific widget element with smooth animation
     * @param {string} widgetId - ID of the widget to scroll to
     */
    scrollToWidget(widgetId) {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
            const widgetElement = document.querySelector(`[data-widget-id="${widgetId}"]`);
            if (widgetElement) {
                widgetElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'nearest'
                });
                // Add a brief highlight effect
                widgetElement.style.transition = 'box-shadow 0.3s ease';
                widgetElement.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.5)';
                setTimeout(() => {
                    widgetElement.style.boxShadow = '';
                }, 1000);
            }
        }, 100);
    }
    
    /**
     * Scroll to a specific section element with smooth animation
     * @param {string} sectionId - ID of the section to scroll to
     */
    scrollToSection(sectionId) {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => {
            const sectionElement = document.querySelector(`[data-section-id="${sectionId}"]`);
            if (sectionElement) {
                sectionElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'nearest'
                });
                // Add a brief highlight effect
                sectionElement.style.transition = 'box-shadow 0.3s ease';
                sectionElement.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.5)';
                setTimeout(() => {
                    sectionElement.style.boxShadow = '';
                }, 1000);
            }
        }, 100);
    }
    
    /**
     * Main render method - rebuilds entire dashboard
     * Steps:
     * 1. Calculate layout for each section (packRows, transformRowBlocks)
     * 2. Render sections (widget sections or filter groups)
     * 3. Setup drag handlers for rendered elements
     */
    render() {
        this.gridCanvas.innerHTML = '';
        
        const containerWidth = this.gridCanvas.clientWidth;
        
        const top = this.gridCanvas.getBoundingClientRect().top;
        const offset = Math.round(top + 20);
        this.gridCanvas.style.setProperty('--fill-offset', offset + 'px');
        
        this.sections.forEach((section, sectionIndex) => {
            const sectionElement = document.createElement('div');
            sectionElement.className = 'section';
            sectionElement.dataset.sectionId = section.id;
            sectionElement.draggable = true;
            
            this.setupSectionDragHandlers(sectionElement, section);
            
            const layout = this.layoutSection(section, containerWidth);
            
            if (layout.type === 'widget') {
                this.renderWidgetSection(sectionElement, section, layout, containerWidth);
            } else if (layout.type === 'filter-group') {
                this.renderFilterGroupSection(sectionElement, section, layout);
            }
            
            this.gridCanvas.appendChild(sectionElement);
        });
    }
    
    renderWidgetSection(sectionElement, section, layout, containerWidth) {
        const colCount = layout.colCount;
        const colWidth = (containerWidth - (colCount - 1) * this.layoutConfig.columnGap) / colCount;
        
        layout.rows.forEach((row, rowIndex) => {
            const rowElement = document.createElement('div');
            rowElement.className = 'row';
            
            const distributeEqually = row.cells.some(cell => cell.distributeEqually);
            if (distributeEqually) {
                rowElement.classList.add('distribute-equally');
            }
            
            let maxHeight = 0;
            console.log(`\n=== Row ${rowIndex} ===`);
            row.cells.forEach((cell, cellIndex) => {
                if (this.isRowBlock(cell.item)) {
                    const height = cell.item.main.minHeightRem;
                    console.log(`Cell ${cellIndex} (RowBlock): main widget height = ${height} rem`);
                    maxHeight = Math.max(maxHeight, height);
                } else {
                    const height = cell.item.minHeightRem;
                    console.log(`Cell ${cellIndex} (Widget ${cell.item.size}): height = ${height} rem`);
                    maxHeight = Math.max(maxHeight, height);
                }
            });
            
            console.log(`Max height for row ${rowIndex}: ${maxHeight} rem (${maxHeight * 16}px)`);
            rowElement.style.minHeight = `${maxHeight * 16}px`;
            
            row.cells.forEach(cell => {
                if (this.isRowBlock(cell.item)) {
                    const rowBlockElement = this.renderRowBlock(cell.item, colWidth, colCount);
                    rowElement.appendChild(rowBlockElement);
                } else {
                    const widgetElement = this.renderWidget(cell.item, cell.span, colWidth, false, distributeEqually);
                    rowElement.appendChild(widgetElement);
                }
            });
            
            sectionElement.appendChild(rowElement);
        });
    }
    
    renderRowBlock(rowBlock, colWidth, colCount) {
        const rowBlockElement = document.createElement('div');
        rowBlockElement.className = 'rowblock';
        
        const railElement = document.createElement('div');
        railElement.className = 'rowblock-rail';
        
        rowBlock.rail.forEach(widget => {
            const widgetElement = this.renderWidget(widget, 1, colWidth, 'rail');
            railElement.appendChild(widgetElement);
        });
        
        const mainElement = document.createElement('div');
        mainElement.className = 'rowblock-main';
        
        const mainWidget = this.renderWidget(rowBlock.main, 3, colWidth, 'main');
        mainElement.appendChild(mainWidget);
        
        rowBlockElement.appendChild(railElement);
        rowBlockElement.appendChild(mainElement);
        
        return rowBlockElement;
    }
    
    /**
     * Render a single widget element
     * @param {object} widget - Widget data object
     * @param {number} span - Column span for this widget
     * @param {number} colWidth - Width of one column in pixels
     * @param {boolean|string} inRowBlock - False, 'main', or 'rail'
     * @param {boolean} distributeEqually - True if row uses equal distribution
     * @param {boolean} inFilterContainer - True if widget is in filter container
     * @returns {HTMLElement} Widget DOM element
     */
    renderWidget(widget, span, colWidth, inRowBlock = false, distributeEqually = false, inFilterContainer = false) {
        const widgetElement = document.createElement('div');
        widgetElement.className = 'widget';
        widgetElement.dataset.widgetId = widget.id;
        widgetElement.draggable = true;
        
        const config = this.getWidgetConfig(widget.size);
        const widthPx = span * colWidth + (span - 1) * this.layoutConfig.columnGap;
        const heightPx = widget.minHeightRem * 16;
        
        if (!distributeEqually && !inRowBlock) {
            widgetElement.style.width = `${widthPx}px`;
        }
        
        if (widget.heightMode === 'fillViewport') {
            widgetElement.style.minHeight = `${heightPx}px`;
            widgetElement.style.height = 'calc(100vh - var(--fill-offset))';
            widgetElement.style.maxHeight = 'calc(100vh - var(--fill-offset))';
            widgetElement.classList.add('fill-viewport');
        } else if (inRowBlock !== 'rail') {
            widgetElement.style.minHeight = `${heightPx}px`;
        }
        
        const headerElement = document.createElement('div');
        headerElement.className = 'widget-header';
        
        const titleElement = document.createElement('div');
        titleElement.className = 'widget-title';
        titleElement.textContent = widget.title || config.displayName;
        titleElement.contentEditable = true;
        titleElement.addEventListener('blur', (e) => {
            widget.title = e.target.textContent;
        });
        titleElement.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        titleElement.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });
        
        const actionsElement = document.createElement('div');
        actionsElement.className = 'widget-actions';
        
        let actionsHTML = '';
        if (!inFilterContainer) {
            actionsHTML += `
                <button class="widget-action-btn widget-filter-btn" title="Add to filter container">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                    </svg>
                </button>
            `;
        }
        actionsHTML += `
            <button class="widget-action-btn widget-delete-btn" title="Delete widget">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
                </svg>
            </button>
        `;
        actionsElement.innerHTML = actionsHTML;
        
        headerElement.appendChild(titleElement);
        headerElement.appendChild(actionsElement);
        
        const contentElement = document.createElement('div');
        contentElement.className = 'widget-content';
        contentElement.innerHTML = `
            <div class="widget-info">Min: ${widget.minColSpan} col × ${widget.minHeightRem} rem</div>
            <div class="widget-info">Span: ${span} col | Mode: ${widget.heightMode}</div>
        `;
        
        widgetElement.appendChild(headerElement);
        widgetElement.appendChild(contentElement);
        
        this.setupWidgetDragHandlers(widgetElement, widget);
        
        const deleteBtn = actionsElement.querySelector('.widget-delete-btn');
        this.setupDeleteHandler(deleteBtn, widget.id);
        
        if (!inFilterContainer) {
            const filterBtn = actionsElement.querySelector('.widget-filter-btn');
            if (filterBtn) {
                filterBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.moveWidgetToFilterContainer(widget.id);
                });
                filterBtn.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                });
            }
        }
        
        return widgetElement;
    }
    
    renderFilterGroupSection(sectionElement, section, layout) {
        sectionElement.classList.add('filter-group-section');
        const group = layout.group;
        
        const headerElement = document.createElement('div');
        headerElement.className = 'filter-group-header';
        
        const titleElement = document.createElement('div');
        titleElement.className = 'filter-group-title';
        titleElement.textContent = group.title || 'Filter Container';
        titleElement.contentEditable = true;
        titleElement.addEventListener('blur', (e) => {
            const newTitle = e.target.textContent.trim();
            group.title = newTitle || 'Filter Container';
            e.target.textContent = group.title;
        });
        titleElement.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
        titleElement.addEventListener('dragstart', (e) => {
            e.preventDefault();
        });
        
        const actionsElement = document.createElement('div');
        actionsElement.className = 'filter-group-actions';
        actionsElement.innerHTML = `
            <button class="filter-group-action-btn filter-group-filter-btn" title="Add filter" data-group-id="${group.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
            </button>
            <button class="filter-group-action-btn filter-group-delete-btn" title="Delete filter container">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"/>
                </svg>
            </button>
        `;
        
        const filterBtn = actionsElement.querySelector('.filter-group-filter-btn');
        filterBtn.addEventListener('click', () => {
            this.addFilterToGroup(group.id);
        });
        
        const deleteBtn = actionsElement.querySelector('.filter-group-delete-btn');
        deleteBtn.addEventListener('click', () => {
            this.sections = this.sections.filter(s => s.id !== section.id);
            this.render();
        });
        
        const headerTopRow = document.createElement('div');
        headerTopRow.className = 'filter-group-header-top';
        headerTopRow.appendChild(titleElement);
        headerTopRow.appendChild(actionsElement);
        
        headerElement.appendChild(headerTopRow);
        
        if (group.filters && group.filters.length > 0) {
            const filtersContainer = document.createElement('div');
            filtersContainer.className = 'filter-chips-container';
            
            group.filters.forEach(filter => {
                const chip = document.createElement('div');
                chip.className = 'filter-chip';
                chip.innerHTML = `
                    <span class="filter-chip-label">${filter.label}</span>
                    <button class="filter-chip-remove" data-filter-id="${filter.id}" data-group-id="${group.id}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                `;
                
                const removeBtn = chip.querySelector('.filter-chip-remove');
                removeBtn.addEventListener('click', () => {
                    this.removeFilterFromGroup(group.id, filter.id);
                });
                
                filtersContainer.appendChild(chip);
            });
            
            headerElement.appendChild(filtersContainer);
        }
        
        sectionElement.appendChild(headerElement);
        
        const filterGroupElement = document.createElement('div');
        filterGroupElement.className = 'filter-group';
        filterGroupElement.dataset.groupId = group.id;
        
        if (group.widgets.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'filter-group-empty';
            emptyState.innerHTML = `
                <div class="empty-state-content">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <line x1="12" y1="8" x2="12" y2="16"/>
                        <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                    <p>Drag widgets here to add them to this filter container</p>
                </div>
            `;
            filterGroupElement.appendChild(emptyState);
        } else {
            const colCount = layout.colCount;
            const colWidth = (layout.containerWidth - (colCount - 1) * this.layoutConfig.columnGap) / colCount;
            
            layout.rows.forEach((row, rowIndex) => {
                const rowElement = document.createElement('div');
                rowElement.className = 'row';
                
                const distributeEqually = row.cells.some(cell => cell.distributeEqually);
                if (distributeEqually) {
                    rowElement.classList.add('distribute-equally');
                }
                
                let maxHeight = 0;
                row.cells.forEach((cell, cellIndex) => {
                    if (this.isRowBlock(cell.item)) {
                        const height = cell.item.main.minHeightRem;
                        maxHeight = Math.max(maxHeight, height);
                    } else {
                        const height = cell.item.minHeightRem;
                        maxHeight = Math.max(maxHeight, height);
                    }
                });
                
                rowElement.style.minHeight = `${maxHeight * 16}px`;
                
                row.cells.forEach(cell => {
                    if (this.isRowBlock(cell.item)) {
                        const rowBlockElement = this.renderRowBlock(cell.item, colWidth, colCount);
                        rowElement.appendChild(rowBlockElement);
                    } else {
                        const widgetElement = this.renderWidget(cell.item, cell.span, colWidth, false, distributeEqually, true);
                        rowElement.appendChild(widgetElement);
                    }
                });
                
                filterGroupElement.appendChild(rowElement);
            });
        }
        
        sectionElement.appendChild(filterGroupElement);
    }
    
    setupWidgetDragHandlers(element, widget) {
        element.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('delete-btn') || 
                e.target.closest('.delete-btn')) {
                e.preventDefault();
                return;
            }
            
            this.draggedWidget = widget;
            this.draggedSection = null;
            this.isDraggingFromPanel = false;
            element.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'widget-move');
            e.stopPropagation();
            this.createDragPlaceholder();
        });
        
        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.removeDragPlaceholder();
        });
    }
    
    setupSectionDragHandlers(element, section) {
        element.addEventListener('dragstart', (e) => {
            if (e.target !== element) {
                return;
            }
            
            this.draggedSection = section;
            this.draggedWidget = null;
            this.isDraggingFromPanel = false;
            element.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'section-move');
            this.createDragPlaceholder();
        });
        
        element.addEventListener('dragend', () => {
            element.classList.remove('dragging');
            this.draggedSection = null;
            this.removeDragPlaceholder();
        });
    }
    
    setupDeleteHandler(button, widgetId) {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteWidget(widgetId);
        });
        
        button.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    }
    
    createDragPlaceholder() {
        this.dragPlaceholder = document.createElement('div');
        this.dragPlaceholder.className = 'drag-placeholder';
        this.dragPlaceholder.style.display = 'none';
        document.body.appendChild(this.dragPlaceholder);
    }
    
    updateDragPlaceholder(targetInfo) {
        if (!this.dragPlaceholder) return;
        
        const color = targetInfo.isInvalid ? '#ef4444' : '#3b82f6';
        
        if (targetInfo.type === 'within-section' || targetInfo.type === 'within-filter-group') {
            if (targetInfo.isRailDropZone) {
                const left = targetInfo.left;
                const right = targetInfo.right;
                const centerY = (targetInfo.top + targetInfo.bottom) / 2;
                
                this.dragPlaceholder.style.left = left + 'px';
                this.dragPlaceholder.style.top = (centerY - 2) + 'px';
                this.dragPlaceholder.style.width = (right - left) + 'px';
                this.dragPlaceholder.style.height = '4px';
                this.dragPlaceholder.style.display = 'block';
                this.dragPlaceholder.style.background = color;
                this.dragPlaceholder.style.border = 'none';
                this.dragPlaceholder.style.borderRadius = '2px';
            } else {
                const centerX = (targetInfo.left + targetInfo.right) / 2;
                const top = targetInfo.top;
                const bottom = targetInfo.bottom;
                
                this.dragPlaceholder.style.left = (centerX - 2) + 'px';
                this.dragPlaceholder.style.top = top + 'px';
                this.dragPlaceholder.style.width = '4px';
                this.dragPlaceholder.style.height = (bottom - top) + 'px';
                this.dragPlaceholder.style.display = 'block';
                this.dragPlaceholder.style.background = color;
                this.dragPlaceholder.style.border = 'none';
                this.dragPlaceholder.style.borderRadius = '2px';
            }
        } else if (targetInfo.type === 'between-sections') {
            const left = targetInfo.left;
            const right = targetInfo.right;
            const centerY = (targetInfo.top + targetInfo.bottom) / 2;
            
            this.dragPlaceholder.style.left = left + 'px';
            this.dragPlaceholder.style.top = (centerY - 2) + 'px';
            this.dragPlaceholder.style.width = (right - left) + 'px';
            this.dragPlaceholder.style.height = '4px';
            this.dragPlaceholder.style.display = 'block';
            this.dragPlaceholder.style.background = color;
            this.dragPlaceholder.style.border = 'none';
            this.dragPlaceholder.style.borderRadius = '2px';
        } else {
            this.dragPlaceholder.style.display = 'none';
        }
    }
    
    removeDragPlaceholder() {
        if (this.dragPlaceholder) {
            this.dragPlaceholder.remove();
            this.dragPlaceholder = null;
        }
    }
    
    createWidget(id, size) {
        const config = this.getWidgetConfig(size);
        return {
            id,
            size,
            minColSpan: config.minColSpan,
            minHeightRem: config.minHeightRem,
            heightMode: config.heightMode
        };
    }
    
    loadInitialState() {
        this.render();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new DashboardEditor();
});
