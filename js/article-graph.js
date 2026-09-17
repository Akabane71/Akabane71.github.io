(function () {
  'use strict';

  function run() {
    var root = document.querySelector('.article-graph-page');
    if (!root || !window.d3) {
      return;
    }
    // PJAX clones HTML attributes but not runtime properties or native listeners.
    if (root.__articleGraphActive) {
      return;
    }
    if (window.__articleGraphCleanup) { window.__articleGraphCleanup(); }
    root.__articleGraphActive = true;
    root.dataset.graphReady = '1';

    var canvas = document.getElementById('article-graph-canvas');
    var context = canvas.getContext('2d');
    var searchInput = document.getElementById('graph-search-input');
    var filterList = document.getElementById('graph-filter-list');
    var details = document.getElementById('graph-details');
    var list = document.getElementById('graph-list');
    var status = document.getElementById('graph-status');
    var emptyState = document.getElementById('graph-empty');
    var scaleValue = document.getElementById('graph-scale-value');
    var loading = document.getElementById('graph-loading');
    var tooltip = document.getElementById('graph-tooltip');
    var resetButton = document.getElementById('graph-reset');
    var fitButton = document.getElementById('graph-fit');
    var drawerBack = document.getElementById('graph-drawer-back');
    var drawerCrumbs = document.getElementById('graph-drawer-crumbs');
    var countNodes = document.getElementById('graph-count-nodes');
    var countLinks = document.getElementById('graph-count-links');
    var countVisible = document.getElementById('graph-count-visible');
    var countCategories = document.getElementById('graph-count-categories');
    var stage = canvas.parentElement;
    var transform = d3.zoomIdentity;
    var hoveredNode = null;
    var selectedNode = null;
    var drawerPath = [];
    var simulation;
    var zoom;
    var nodes = [];
    var links = [];
    var linksByNode = new Map();
    var edgeByPair = new Map();
    var activeCategories = new Set();
    var chipByCategory = new Map();
    var allCategories = [];
    var allChip;
    var layoutColumns = 0;
    var resizeObserver;
    var resizeFrame;
    var searchTimer;
    var request = new AbortController();
    var palette = ['#789b70', '#719aa5', '#b58f6b', '#ad7e8d', '#8b8eb2', '#6faaa0', '#b5a365', '#869fbb', '#a594bb', '#b58c83', '#80a58d', '#8ea18e', '#9da77a', '#829ba6', '#a2957f'];
    var colorByCategory = new Map();
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    filterList.replaceChildren();
    details.replaceChildren();
    details.hidden = true;
    loading.hidden = false;
    emptyState.hidden = true;
    emptyState.textContent = '没有匹配的文章，换个关键词试试。';
    searchInput.value = '';
    root.classList.remove('show-list', 'has-selection');
    root.querySelectorAll('.graph-mode').forEach(function (button) {
      var active = button.dataset.graphMode === 'map';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });

    function colorFor(category) {
      if (!colorByCategory.has(category)) {
        colorByCategory.set(category, palette[colorByCategory.size % palette.length]);
      }
      return colorByCategory.get(category);
    }

    function resizeCanvas() {
      var bounds = stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) { return; }
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    function screenToGraph(event) {
      var bounds = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - bounds.left - transform.x) / transform.k,
        y: (event.clientY - bounds.top - transform.y) / transform.k
      };
    }

    function nodeRadius(node) {
      return 2.5 + Math.sqrt(node.degree || 0) * .7;
    }

    function isVisible(node) {
      var query = searchInput.value.trim().toLocaleLowerCase();
      if (!activeCategories.has(node.group)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [node.title].concat(node.tags, node.categories).join(' ').toLocaleLowerCase().indexOf(query) !== -1;
    }

    function visibleNodes() {
      return nodes.filter(isVisible);
    }

    function nodeIsRelated(node, focus) {
      if (!focus || node === focus) {
        return true;
      }
      return linksByNode.has(focus.id) && linksByNode.get(focus.id).has(node.id);
    }

    function draw() {
      if (!root.isConnected || root.classList.contains('show-list')) { return; }
      var bounds = stage.getBoundingClientRect();
      var width = bounds.width;
      var height = bounds.height;
      var visible = visibleNodes();
      var visibleIds = new Set(visible.map(function (node) { return node.id; }));
      var focus = selectedNode || hoveredNode;
      var k = transform.k;

      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(transform.x, transform.y);
      context.scale(k, k);

      context.beginPath();
      links.forEach(function (link) {
        var source = link.source;
        var target = link.target;
        if (!source.id || !visibleIds.has(source.id) || !visibleIds.has(target.id)) {
          return;
        }
        if (!Number.isFinite(source.x) || !Number.isFinite(target.x)) {
          return;
        }
        if (focus && (source === focus || target === focus)) {
          return;
        }
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
      });
      context.lineWidth = 0.7 / k;
      context.strokeStyle = focus ? 'rgba(98, 126, 93, 0.035)' : 'rgba(98, 126, 93, 0.13)';
      context.stroke();

      if (focus) {
        context.beginPath();
        links.forEach(function (link) {
          if (link.source !== focus && link.target !== focus) {
            return;
          }
          if (!visibleIds.has(link.source.id) || !visibleIds.has(link.target.id)) {
            return;
          }
          context.moveTo(link.source.x, link.source.y);
          context.lineTo(link.target.x, link.target.y);
        });
        context.lineWidth = 1.1 / k;
        context.strokeStyle = 'rgba(70, 123, 85, 0.48)';
        context.stroke();
      }

      visible.forEach(function (node) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
          return;
        }
        var related = nodeIsRelated(node, focus);
        var isFocus = node === selectedNode || node === hoveredNode;
        var r = nodeRadius(node) * Math.max(.6, Math.min(1, Math.sqrt(k))) / k;
        var color = isFocus ? '#30765b' : colorFor(node.group);

        context.globalAlpha = related ? 1 : 0.18;
        context.beginPath();
        context.arc(node.x, node.y, r, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
        context.lineWidth = 1.2 / k;
        context.strokeStyle = '#fcfdf9';
        context.stroke();

        if (isFocus) {
          context.globalAlpha = 1;
          context.beginPath();
          context.arc(node.x, node.y, r + 3.5 / k, 0, Math.PI * 2);
          context.lineWidth = 1.4 / k;
          context.strokeStyle = '#70a381';
          context.stroke();
        }
      });

      context.restore();
      context.globalAlpha = 1;

      // Labels live in screen coordinates so they remain crisp and never overlap.
      var occupied = [];
      function label(text, x, y, color, important) {
        context.font = (important ? '600 ' : '500 ') + '11px "PingFang SC","Microsoft YaHei",sans-serif';
        var w = context.measureText(text).width;
        var box = { x: x - 5, y: y - 12, w: w + 10, h: 20 };
        if (box.x < 4 || box.y < 4 || box.x + box.w > width - 4 || box.y + box.h > height - 4) { return; }
        if (occupied.some(function (b) { return box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y; })) { return; }
        occupied.push(box);
        context.fillStyle = 'rgba(252,253,249,.94)';
        context.fillRect(box.x, box.y, box.w, box.h);
        context.fillStyle = color;
        context.fillText(text, x, y + 2);
      }
      if (focus && isVisible(focus)) {
        label(focus.title, focus.x * k + transform.x + nodeRadius(focus) + 7, focus.y * k + transform.y, '#304c39', true);
      }
      if (!focus && !searchInput.value.trim() && activeCategories.size > 1) {
        var groups = drawerGroupBy(visible, function (node) { return node.group; });
        groups.forEach(function (group, name) {
          var x = d3.mean(group, function (node) { return node.x; }) * k + transform.x;
          var y = d3.min(group, function (node) { return node.y; }) * k + transform.y - 16;
          context.font = '500 11px "PingFang SC","Microsoft YaHei",sans-serif';
          label(name, x - context.measureText(name).width / 2, y, colorFor(name), false);
        });
      }
      if (k > 1.35 || searchInput.value.trim() || activeCategories.size === 1) {
        visible.slice().sort(function (a, b) { return b.degree - a.degree; }).forEach(function (node) {
          if (node === focus || (focus && !nodeIsRelated(node, focus))) { return; }
          var title = node.title.length > 27 ? node.title.slice(0, 26) + '…' : node.title;
          label(title, node.x * k + transform.x + nodeRadius(node) + 5, node.y * k + transform.y, '#6c7d68', false);
        });
      }

      emptyState.hidden = visible.length !== 0;
      if (scaleValue) {
        scaleValue.textContent = Math.round(k * 100) + '%';
      }
      if (countVisible) {
        countVisible.textContent = visible.length;
      }
      updateTooltip();
    }

    function relationLabel(reasons) {
      var labels = { manual: '手工关联', subCategory: '同专题', category: '同分类', tag: '同标签' };
      return (reasons || []).map(function (reason) { return labels[reason] || reason; }).join(' / ');
    }

    function appendTextElement(parent, tagName, text, className) {
      var element = document.createElement(tagName);
      if (className) {
        element.className = className;
      }
      element.textContent = text;
      parent.appendChild(element);
      return element;
    }

    function edgeFor(a, b) {
      return edgeByPair.get(a + '|' + b) || edgeByPair.get(b + '|' + a);
    }

    function renderDetails(node) {
      details.replaceChildren();
      details.scrollTop = 0;
      details.hidden = !node;
      root.classList.toggle('has-selection', Boolean(node));
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'graph-details-close';
      close.setAttribute('aria-label', '关闭详情');
      close.textContent = '×';
      close.hidden = !node;
      close.addEventListener('click', function () {
        selectedNode = null;
        renderDetails(null);
        canvas.focus({ preventScroll: true });
        draw();
      });
      details.appendChild(close);

      if (!node) {
        details.classList.add('is-empty');
        return;
      }

      details.classList.remove('is-empty');
      appendTextElement(details, 'p', node.group + ' / 文章', 'graph-detail-label');
      appendTextElement(details, 'h2', node.title);
      var meta = document.createElement('ul');
      meta.className = 'graph-meta';
      appendTextElement(meta, 'li', node.date || '日期未知');
      (node.categories.length ? node.categories : ['未分类']).forEach(function (category) {
        appendTextElement(meta, 'li', category);
      });
      details.appendChild(meta);
      appendTextElement(details, 'p', node.summary || '这篇文章暂未提供摘要。');

      var readLink = document.createElement('a');
      readLink.className = 'graph-read site_url';
      readLink.href = node.path;
      readLink.textContent = '阅读文章 →';
      details.appendChild(readLink);

      var related = Array.from(linksByNode.get(node.id) || [])
        .map(function (id) { return nodes.find(function (candidate) { return candidate.id === id; }); })
        .filter(Boolean)
        .sort(function (left, right) { return (edgeFor(node.id, right.id).weight) - (edgeFor(node.id, left.id).weight); })
        .slice(0, 6);
      if (related.length) {
        appendTextElement(details, 'p', '关联文章', 'graph-panel-hint');
        var relatedList = document.createElement('ul');
        relatedList.className = 'graph-related';
        related.forEach(function (relatedNode) {
          var item = document.createElement('li');
          var link = document.createElement('a');
          link.className = 'site_url';
          link.href = relatedNode.path;
          link.textContent = relatedNode.title;
          item.appendChild(link);
          var edge = edgeFor(node.id, relatedNode.id);
          appendTextElement(item, 'span', relationLabel(edge && edge.reasons), 'graph-reason');
          relatedList.appendChild(item);
        });
        details.appendChild(relatedList);
      }

    }

    function drawerGroupBy(items, keyFn) {
      var map = new Map();
      items.forEach(function (item) {
        var key = keyFn(item);
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key).push(item);
      });
      return map;
    }

    function drawerArticleRow(node) {
      var item = document.createElement('li');
      item.className = 'graph-leaf';
      var link = document.createElement('a');
      link.className = 'site_url';
      link.href = node.path;
      link.textContent = node.title;
      var metadata = document.createElement('span');
      metadata.textContent = (node.categories.join(' · ') || '未分类') + ' · ' + (node.date || '');
      link.appendChild(metadata);
      item.appendChild(link);
      return item;
    }

    function drawerFolderRow(name, count, color, onEnter) {
      var item = document.createElement('li');
      item.className = 'graph-folder';
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', name + '，' + count + ' 篇文章');
      var dot = document.createElement('span');
      dot.className = 'graph-folder-dot';
      dot.style.background = color;
      var label = document.createElement('span');
      label.className = 'graph-folder-name';
      label.textContent = name;
      var num = document.createElement('span');
      num.className = 'graph-folder-count';
      num.textContent = count;
      var arrow = document.createElement('span');
      arrow.className = 'graph-folder-arrow';
      arrow.textContent = '›';
      item.appendChild(dot);
      item.appendChild(label);
      item.appendChild(num);
      item.appendChild(arrow);
      item.addEventListener('click', onEnter);
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEnter();
        }
      });
      return item;
    }

    function renderCrumbs(items) {
      drawerCrumbs.replaceChildren();
      items.forEach(function (crumb, index) {
        if (index > 0) {
          var sep = document.createElement('span');
          sep.className = 'crumb-sep';
          sep.textContent = '/';
          drawerCrumbs.appendChild(sep);
        }
        var span = document.createElement(crumb.level === undefined ? 'span' : 'button');
        span.textContent = crumb.label;
        if (crumb.level === undefined) {
          span.className = 'crumb current';
        } else {
          span.type = 'button';
          span.className = 'crumb';
          span.tabIndex = 0;
          var level = crumb.level;
          var jump = function () {
            drawerPath = drawerPath.slice(0, level);
            renderDrawer('back');
          };
          span.addEventListener('click', jump);
        }
        drawerCrumbs.appendChild(span);
      });
    }

    function renderDrawer(direction) {
      if (direction) {
        requestAnimationFrame(function () {
          if (root.isConnected && root.classList.contains('show-list')) {
            var target = list.querySelector('[tabindex], a') || drawerBack;
            target.focus({ preventScroll: true });
          }
        });
      }
      var pool = visibleNodes();
      // Keep drawer path valid when filters change.
      if (drawerPath[0] && !activeCategories.has(drawerPath[0])) {
        drawerPath = [];
      }

      list.className = 'graph-drawer-panel';
      list.replaceChildren();
      list.scrollTop = 0;

      var query = searchInput.value.trim();
      if (query) {
        renderCrumbs([{ label: '搜索结果 · ' + pool.length }]);
        drawerBack.disabled = true;
        pool.slice().sort(function (a, b) { return a.title.localeCompare(b.title, 'zh'); })
          .forEach(function (node) { list.appendChild(drawerArticleRow(node)); });
        return;
      }

      if (drawerPath.length === 0) {
        list.classList.add('is-categories');
        renderCrumbs([{ label: '全部分类' }]);
        drawerBack.disabled = true;
        var byCategory = drawerGroupBy(pool, function (node) { return node.group; });
        Array.from(byCategory.keys()).sort(function (a, b) { return a.localeCompare(b, 'zh'); })
          .forEach(function (category) {
            list.appendChild(drawerFolderRow(category, byCategory.get(category).length, colorFor(category), function () {
              drawerPath = [category];
              renderDrawer('enter');
            }));
          });
        return;
      }

      if (drawerPath.length === 1) {
        var cat = drawerPath[0];
        renderCrumbs([{ label: '全部分类', level: 0 }, { label: cat }]);
        drawerBack.disabled = false;
        var inCat = pool.filter(function (node) { return node.group === cat; });
        var subMap = drawerGroupBy(inCat.filter(function (node) { return node.categories.length >= 2; }), function (node) { return node.categories[1]; });
        Array.from(subMap.keys()).sort(function (a, b) { return a.localeCompare(b, 'zh'); })
          .forEach(function (sub) {
            list.appendChild(drawerFolderRow(sub, subMap.get(sub).length, colorFor(cat), function () {
              drawerPath = [cat, sub];
              renderDrawer('enter');
            }));
          });
        inCat.filter(function (node) { return node.categories.length < 2; })
          .sort(function (a, b) { return a.title.localeCompare(b.title, 'zh'); })
          .forEach(function (node) { list.appendChild(drawerArticleRow(node)); });
        return;
      }

      var topCat = drawerPath[0];
      var subCat = drawerPath[1];
      renderCrumbs([{ label: '全部分类', level: 0 }, { label: topCat, level: 1 }, { label: subCat }]);
      drawerBack.disabled = false;
      pool.filter(function (node) { return node.group === topCat && node.categories[1] === subCat; })
        .sort(function (a, b) { return a.title.localeCompare(b.title, 'zh'); })
        .forEach(function (node) { list.appendChild(drawerArticleRow(node)); });
    }

    function renderFilters(categories, counts) {
      allCategories = categories.slice();
      allChip = document.createElement('button');
      allChip.type = 'button';
      allChip.className = 'graph-chip';
      allChip.textContent = '全部';
      allChip.setAttribute('aria-pressed', 'true');
      allChip.addEventListener('click', function () { selectCategory(null); });
      filterList.appendChild(allChip);
      categories.forEach(function (category) {
        activeCategories.add(category);
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'graph-chip';
        chip.setAttribute('aria-pressed', 'false');

        var dot = document.createElement('span');
        dot.className = 'graph-chip-dot';
        dot.style.color = colorFor(category);
        dot.style.background = colorFor(category);

        var name = document.createElement('span');
        name.textContent = category;

        var num = document.createElement('span');
        num.className = 'graph-chip-num';
        num.textContent = counts.get(category) || 0;

        chip.appendChild(dot);
        chip.appendChild(name);
        chip.appendChild(num);
        chip.addEventListener('click', function () {
          selectCategory(activeCategories.size === 1 && activeCategories.has(category) ? null : category);
        });
        chipByCategory.set(category, chip);
        filterList.appendChild(chip);
      });
    }

    function selectCategory(category) {
      activeCategories = new Set(category ? [category] : allCategories);
      allChip.setAttribute('aria-pressed', String(!category));
      chipByCategory.forEach(function (chip, name) { chip.setAttribute('aria-pressed', String(name === category)); });
      drawerPath = category ? [category] : [];
      hoveredNode = null;
      selectedNode = null;
      renderDetails(null);
      refresh();
      fitView(true);
    }

    function updateCounts() {
      if (countNodes) { countNodes.textContent = nodes.length; }
      if (countLinks) { countLinks.textContent = links.length; }
      if (countCategories) { countCategories.textContent = allCategories.length; }
      if (countVisible) { countVisible.textContent = visibleNodes().length; }
    }

    function refresh() {
      if (selectedNode && !isVisible(selectedNode)) {
        selectedNode = null;
        renderDetails(null);
      }
      var visible = visibleNodes().length;
      status.textContent = visible === nodes.length ? nodes.length + ' 篇文章' : visible + ' / ' + nodes.length + ' 篇文章';
      updateCounts();
      renderDrawer();
      emptyState.hidden = visible !== 0;
      draw();
    }

    function findNodeAt(event) {
      var point = screenToGraph(event);
      var candidates = visibleNodes();
      var best = null;
      var bestDistance = Infinity;
      candidates.forEach(function (node) {
        if (!Number.isFinite(node.x)) {
          return;
        }
        var hit = (nodeRadius(node) + 8) / transform.k;
        var distance = Math.hypot(node.x - point.x, node.y - point.y);
        if (distance <= hit && distance < bestDistance) {
          best = node;
          bestDistance = distance;
        }
      });
      return best;
    }

    function updateTooltip() {
      if (!hoveredNode || !Number.isFinite(hoveredNode.x)) {
        tooltip.hidden = true;
        return;
      }
      tooltip.hidden = false;
      tooltip.replaceChildren();
      tooltip.appendChild(document.createTextNode(hoveredNode.title));
      var meta = document.createElement('small');
      meta.textContent = (hoveredNode.categories[0] || '未分类') + ' · ' + linksByNode.get(hoveredNode.id).size + ' 条关联';
      tooltip.appendChild(meta);
      var x = hoveredNode.x * transform.k + transform.x;
      var y = hoveredNode.y * transform.k + transform.y;
      tooltip.style.left = Math.max(8, Math.min(stage.clientWidth - tooltip.offsetWidth - 8, x - tooltip.offsetWidth / 2)) + 'px';
      tooltip.style.top = Math.max(8, Math.min(stage.clientHeight - tooltip.offsetHeight - 8, y - tooltip.offsetHeight - 14)) + 'px';
    }

    function fitView(animate) {
      if (!zoom || root.classList.contains('show-list')) { return; }
      var visible = visibleNodes().filter(function (node) { return Number.isFinite(node.x); });
      if (!visible.length) {
        return;
      }
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      visible.forEach(function (node) {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x);
        maxY = Math.max(maxY, node.y);
      });
      var bounds = stage.getBoundingClientRect();
      var pad = bounds.width < 500 ? 38 : 54;
      var spanX = Math.max(100, maxX - minX);
      var spanY = Math.max(100, maxY - minY);
      var k = Math.min(2.4, Math.max(0.08, Math.min(Math.max(40, bounds.width - pad * 2) / spanX, Math.max(40, bounds.height - pad * 2) / spanY)));
      var tx = bounds.width / 2 - k * (minX + maxX) / 2;
      var ty = bounds.height / 2 - k * (minY + maxY) / 2;
      var target = d3.zoomIdentity.translate(tx, ty).scale(k);
      var selection = d3.select(canvas);
      if (animate && !reducedMotion) {
        selection.transition().duration(450).call(zoom.transform, target);
      } else {
        selection.call(zoom.transform, target);
      }
    }

    function focusNode(node) {
      if (!node) {
        return;
      }
      selectedNode = node;
      renderDetails(node);
      resizeCanvas();
      var bounds = stage.getBoundingClientRect();
      var centerX = bounds.width / 2;
      var centerY = bounds.height / 2;
      if (root.parentElement.clientWidth <= 600) {
        centerY = Math.max(50, (bounds.height - details.offsetHeight - 16) / 2);
      } else if (root.parentElement.clientWidth <= 900) {
        centerX = Math.max(70, (bounds.width - details.offsetWidth - 24) / 2);
      }
      var target = d3.zoomIdentity.translate(centerX - node.x * 1.4, centerY - node.y * 1.4).scale(1.4);
      var selection = d3.select(canvas);
      if (reducedMotion) {
        selection.call(zoom.transform, target);
      } else {
        selection.transition().duration(400).call(zoom.transform, target);
      }
    }

    function resetView() {
      clearTimeout(searchTimer);
      searchInput.value = '';
      selectedNode = null;
      hoveredNode = null;
      tooltip.hidden = true;
      drawerPath = [];
      activeCategories = new Set(allCategories);
      allChip.setAttribute('aria-pressed', 'true');
      chipByCategory.forEach(function (chip) {
        chip.setAttribute('aria-pressed', 'false');
      });
      renderDetails(null);
      refresh();
      fitView(true);
    }

    function setupGraph(data) {
      if (!root.isConnected || request.signal.aborted) { return; }
      nodes = data.nodes.map(function (node) { return Object.assign({}, node); });
      var nodeById = new Map(nodes.map(function (node) { return [node.id, node]; }));
      links = data.edges
        .filter(function (edge) { return nodeById.has(edge.source) && nodeById.has(edge.target); })
        .map(function (edge) { return Object.assign({}, edge); });
      linksByNode = new Map(nodes.map(function (node) { return [node.id, new Set()]; }));
      edgeByPair = new Map();
      links.forEach(function (link) {
        linksByNode.get(link.source).add(link.target);
        linksByNode.get(link.target).add(link.source);
        edgeByPair.set(link.source + '|' + link.target, link);
      });
      nodes.forEach(function (node) {
        node.degree = linksByNode.get(node.id).size;
      });

      var counts = new Map();
      nodes.forEach(function (node) {
        counts.set(node.group, (counts.get(node.group) || 0) + 1);
      });

      renderFilters(data.categories, counts);
      resizeCanvas();

      zoom = d3.zoom()
        .scaleExtent([0.08, 4])
        .clickDistance(5)
        .on('zoom', function (event) {
          transform = event.transform;
          draw();
        });
      d3.select(canvas).call(zoom).on('dblclick.zoom', null);

      var categoryIndex = new Map(data.categories.map(function (category, index) { return [category, index]; }));
      function positionGroups() {
        var aspect = Math.max(.65, Math.min(2, stage.clientWidth / Math.max(1, stage.clientHeight)));
        var columns = Math.max(1, Math.ceil(Math.sqrt(data.categories.length * aspect)));
        if (columns === layoutColumns) { return false; }
        layoutColumns = columns;
        var groupOffsets = new Map();
        nodes.forEach(function (node) {
          var index = categoryIndex.get(node.group);
          var offset = groupOffsets.get(node.group) || 0;
          groupOffsets.set(node.group, offset + 1);
          node.anchorX = (index % columns) * 290 + (Math.floor(index / columns) % 2) * 45;
          node.anchorY = Math.floor(index / columns) * 270 + Math.sin(index * 1.7) * 25;
          node.x = node.anchorX + Math.cos(offset * 2.4) * Math.sqrt(offset) * 24;
          node.y = node.anchorY + Math.sin(offset * 2.4) * Math.sqrt(offset) * 24;
          node.vx = node.vy = 0;
        });
        return true;
      }
      positionGroups();
      simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(function (node) { return node.id; }).distance(64).strength(function (link) { return link.source.group === link.target.group ? .22 : .01; }))
        .force('charge', d3.forceManyBody().strength(-105).distanceMax(200))
        .force('collide', d3.forceCollide().radius(function (node) { return nodeRadius(node) + 13; }))
        .force('x', d3.forceX(function (node) { return node.anchorX; }).strength(.22))
        .force('y', d3.forceY(function (node) { return node.anchorY; }).strength(.22))
        .stop();
      // Settle once: no initial scatter, motion, or late automatic zoom interrupting exploration.
      simulation.tick(180);
      loading.hidden = true;
      fitView(false);

      canvas.addEventListener('mousemove', function (event) {
        var node = findNodeAt(event);
        if (node !== hoveredNode) {
          hoveredNode = node;
          canvas.style.cursor = node ? 'pointer' : 'grab';
          draw();
        }
      });
      canvas.addEventListener('mouseleave', function () {
        if (hoveredNode) {
          hoveredNode = null;
          canvas.style.cursor = 'grab';
          draw();
        }
      });
      canvas.addEventListener('click', function (event) {
        var node = findNodeAt(event);
        if (node) { focusNode(node); }
        else { selectedNode = null; renderDetails(null); }
        draw();
      });
      canvas.addEventListener('dblclick', function () { fitView(true); });

      var previousWidth = stage.clientWidth;
      var previousHeight = stage.clientHeight;
      resizeObserver = new ResizeObserver(function () {
        if (!stage.clientWidth || !stage.clientHeight) { return; }
        if (stage.clientWidth === previousWidth && stage.clientHeight === previousHeight) { return; }
        previousWidth = stage.clientWidth;
        previousHeight = stage.clientHeight;
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(function () {
          if (positionGroups()) {
            simulation.force('x').x(function (node) { return node.anchorX; });
            simulation.force('y').y(function (node) { return node.anchorY; });
            simulation.alpha(1).tick(180);
          }
          resizeCanvas();
          if (selectedNode) { focusNode(selectedNode); } else { fitView(false); }
        });
      });
      resizeObserver.observe(stage);
      resetButton.addEventListener('click', resetView);
      fitButton.addEventListener('click', function () { fitView(true); });
      function changeZoom(factor) {
        var selection = d3.select(canvas);
        if (!reducedMotion) { selection = selection.transition().duration(180); }
        selection.call(zoom.scaleBy, factor);
      }
      document.getElementById('graph-zoom-in').addEventListener('click', function () { changeZoom(1.3); });
      document.getElementById('graph-zoom-out').addEventListener('click', function () { changeZoom(1 / 1.3); });
      canvas.addEventListener('keydown', function (event) {
        var pan = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
        if (pan[event.key]) {
          event.preventDefault();
          d3.select(canvas).call(zoom.translateBy, pan[event.key][0] / transform.k, pan[event.key][1] / transform.k);
        } else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1.3); }
        else if (event.key === '-') { event.preventDefault(); changeZoom(1 / 1.3); }
        else if (event.key === '0') { event.preventDefault(); fitView(true); }
        else if (event.key === 'Escape') { selectedNode = null; renderDetails(null); draw(); }
      });
      drawerBack.addEventListener('click', function () {
        if (drawerPath.length) {
          drawerPath.pop();
          renderDrawer('back');
        }
      });
      searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { hoveredNode = null; refresh(); fitView(true); }, 100);
      });
      searchInput.addEventListener('keydown', function (event) {
        if (event.isComposing) { return; }
        if (event.key === 'Enter') {
          if (!root.classList.contains('show-list')) { clearTimeout(searchTimer); refresh(); focusNode(visibleNodes()[0]); }
        }
        if (event.key === 'Escape') {
          clearTimeout(searchTimer);
          searchInput.value = '';
          selectedNode = null;
          hoveredNode = null;
          renderDetails(null);
          refresh();
          fitView(true);
        }
      });
      document.querySelectorAll('.graph-mode').forEach(function (button) {
        button.addEventListener('click', function () {
          var showList = button.dataset.graphMode === 'list';
          root.classList.toggle('show-list', showList);
          document.querySelectorAll('.graph-mode').forEach(function (modeButton) {
            var active = modeButton === button;
            modeButton.classList.toggle('active', active);
            modeButton.setAttribute('aria-pressed', String(active));
          });
          if (!showList) {
            resizeCanvas();
            if (selectedNode) { focusNode(selectedNode); }
            else { fitView(false); }
          }
        });
      });

      root.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && selectedNode && event.target !== searchInput) {
          selectedNode = null;
          hoveredNode = null;
          renderDetails(null);
          canvas.focus({ preventScroll: true });
          draw();
        }
      });

      refresh();
    }

    window.__articleGraphCleanup = function () {
      request.abort();
      if (simulation) { simulation.stop(); }
      if (resizeObserver) { resizeObserver.disconnect(); }
      cancelAnimationFrame(resizeFrame);
      clearTimeout(searchTimer);
      d3.select(canvas).interrupt().on('.zoom', null);
      delete root.dataset.graphReady;
      delete root.__articleGraphActive;
      window.__articleGraphCleanup = null;
    };

    fetch(root.dataset.graphUrl, { signal: request.signal })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Unable to load graph data');
        }
        return response.json();
      })
      .then(setupGraph)
      .catch(function (error) {
        if (error.name === 'AbortError') { return; }
        loading.hidden = true;
        status.textContent = '星图数据加载失败，请刷新后重试。';
        emptyState.hidden = false;
        emptyState.textContent = '星图暂时不可用。';
      });
  }

  window.__articleGraphInit = run;
}());
