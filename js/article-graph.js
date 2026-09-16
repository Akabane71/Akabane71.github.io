(function () {
  'use strict';

  function run() {
    var root = document.querySelector('.article-graph-page');
    if (!root || !window.d3) {
      return;
    }
    if (root.dataset.graphReady) {
      return;
    }
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
    var hudSector = document.getElementById('graph-hud-sector');
    var tooltip = document.getElementById('graph-tooltip');
    var resetButton = document.getElementById('graph-reset');
    var fitButton = document.getElementById('graph-fit');
    var drawerBack = document.getElementById('graph-drawer-back');
    var drawerCrumbs = document.getElementById('graph-drawer-crumbs');
    var countNodes = document.getElementById('graph-count-nodes');
    var countLinks = document.getElementById('graph-count-links');
    var countVisible = document.getElementById('graph-count-visible');
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
    var hubDegree = 4;
    var palette = ['#33caa6', '#4078c0', '#f0a24a', '#e0707a', '#7e6bd6', '#3fb0d6', '#5aa469', '#c99a3a', '#c56bb0', '#7f8fa6', '#d98b5f', '#6ab0a0'];
    var colorByCategory = new Map();
    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function colorFor(category) {
      if (!colorByCategory.has(category)) {
        colorByCategory.set(category, palette[colorByCategory.size % palette.length]);
      }
      return colorByCategory.get(category);
    }

    function resizeCanvas() {
      var bounds = stage.getBoundingClientRect();
      var ratio = window.devicePixelRatio || 1;
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
      return 2.6 + Math.sqrt(node.degree || 0) * 1.15;
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
      context.strokeStyle = focus ? 'rgba(47, 47, 47, 0.05)' : 'rgba(47, 47, 47, 0.08)';
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
        context.strokeStyle = 'rgba(51, 202, 166, 0.6)';
        context.stroke();
      }

      visible.forEach(function (node) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
          return;
        }
        var related = nodeIsRelated(node, focus);
        var isFocus = node === selectedNode || node === hoveredNode;
        var r = nodeRadius(node) / k;
        var color = isFocus ? '#2ba98a' : colorFor(node.group);

        context.globalAlpha = related ? 1 : 0.18;
        context.beginPath();
        context.arc(node.x, node.y, r, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();

        if (isFocus) {
          context.globalAlpha = 1;
          context.beginPath();
          context.arc(node.x, node.y, r + 3.5 / k, 0, Math.PI * 2);
          context.lineWidth = 1.4 / k;
          context.strokeStyle = '#33caa6';
          context.stroke();
        }

        var showLabel = isFocus || k >= 1.55 || (node.degree >= hubDegree && k >= 0.82);
        if (showLabel) {
          context.globalAlpha = related ? 0.92 : 0.3;
          context.fillStyle = isFocus ? '#2f2f2f' : 'rgba(47, 47, 47, 0.82)';
          context.font = (isFocus ? 12.5 : 10.5) / k + 'px ' + '"PingFang SC","Microsoft YaHei",sans-serif';
          context.fillText(node.title, node.x + (nodeRadius(node) + 5) / k, node.y + 3.5 / k);
        }
      });

      context.restore();
      context.globalAlpha = 1;

      emptyState.hidden = visible.length !== 0;
      if (scaleValue) {
        scaleValue.textContent = Math.round(k * 100) + '%';
      }
      if (countVisible) {
        countVisible.textContent = visible.length;
      }
      if (hudSector) {
        var cx = Math.round((width / 2 - transform.x) / k);
        var cy = Math.round((height / 2 - transform.y) / k);
        hudSector.textContent = 'X' + cx + ' · Y' + cy;
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
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'graph-details-close';
      close.setAttribute('aria-label', '关闭详情');
      close.textContent = '×';
      close.hidden = !node;
      close.addEventListener('click', function () {
        selectedNode = null;
        renderDetails(null);
        draw();
      });
      details.appendChild(close);

      if (!node) {
        details.classList.add('is-empty');
        appendTextElement(details, 'h2', '选择一颗星点');
        appendTextElement(details, 'p', '点击星点查看关联文章', 'graph-panel-hint');
        return;
      }

      details.classList.remove('is-empty');
      appendTextElement(details, 'h2', node.title);
      var meta = document.createElement('ul');
      meta.className = 'graph-meta';
      appendTextElement(meta, 'li', node.date || '日期未知');
      (node.categories.length ? node.categories : ['未分类']).forEach(function (category) {
        appendTextElement(meta, 'li', category);
      });
      details.appendChild(meta);
      appendTextElement(details, 'p', node.summary || '这篇文章暂未提供摘要。');

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
          link.href = relatedNode.path;
          link.textContent = relatedNode.title;
          item.appendChild(link);
          var edge = edgeFor(node.id, relatedNode.id);
          appendTextElement(item, 'span', relationLabel(edge && edge.reasons), 'graph-reason');
          relatedList.appendChild(item);
        });
        details.appendChild(relatedList);
      }

      var readLink = document.createElement('a');
      readLink.className = 'graph-read';
      readLink.href = node.path;
      readLink.textContent = '阅读文章 →';
      details.appendChild(readLink);
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
      link.href = node.path;
      link.textContent = node.title;
      var metadata = document.createElement('span');
      metadata.textContent = (node.categories.join(' · ') || '未分类') + ' · ' + (node.date || '');
      item.appendChild(link);
      item.appendChild(metadata);
      return item;
    }

    function drawerFolderRow(name, count, color, onEnter) {
      var item = document.createElement('li');
      item.className = 'graph-folder';
      item.tabIndex = 0;
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
        var span = document.createElement('span');
        span.textContent = crumb.label;
        if (crumb.level === undefined) {
          span.className = 'crumb current';
        } else {
          span.className = 'crumb';
          span.tabIndex = 0;
          var level = crumb.level;
          var jump = function () {
            drawerPath = drawerPath.slice(0, level);
            renderDrawer('back');
          };
          span.addEventListener('click', jump);
          span.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') { jump(); }
          });
        }
        drawerCrumbs.appendChild(span);
      });
    }

    function renderDrawer(direction) {
      var pool = visibleNodes();
      // Keep drawer path valid when filters change.
      if (drawerPath[0] && !activeCategories.has(drawerPath[0])) {
        drawerPath = [];
      }

      list.className = 'graph-drawer-panel';
      void list.offsetWidth;
      if (direction) {
        list.classList.add(direction);
      }
      list.replaceChildren();

      var query = searchInput.value.trim();
      if (query) {
        renderCrumbs([{ label: '搜索结果 · ' + pool.length }]);
        drawerBack.disabled = true;
        pool.slice().sort(function (a, b) { return a.title.localeCompare(b.title, 'zh'); })
          .forEach(function (node) { list.appendChild(drawerArticleRow(node)); });
        return;
      }

      if (drawerPath.length === 0) {
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
      categories.forEach(function (category) {
        activeCategories.add(category);
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'graph-chip';
        chip.setAttribute('aria-pressed', 'true');

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
          var on = activeCategories.has(category);
          if (on) {
            activeCategories.delete(category);
          } else {
            activeCategories.add(category);
          }
          chip.classList.toggle('is-off', on);
          chip.setAttribute('aria-pressed', String(!on));
          refresh();
        });
        chipByCategory.set(category, chip);
        filterList.appendChild(chip);
      });
    }

    function updateCounts() {
      if (countNodes) { countNodes.textContent = nodes.length; }
      if (countLinks) { countLinks.textContent = links.length; }
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
      tooltip.style.left = (hoveredNode.x * transform.k + transform.x) + 'px';
      tooltip.style.top = (hoveredNode.y * transform.k + transform.y) + 'px';
    }

    function fitView(animate) {
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
      var pad = 70;
      var spanX = Math.max(1, maxX - minX);
      var spanY = Math.max(1, maxY - minY);
      var k = Math.min(2.4, Math.max(0.4, Math.min((bounds.width - pad * 2) / spanX, (bounds.height - pad * 2) / spanY)));
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
      var bounds = stage.getBoundingClientRect();
      var target = d3.zoomIdentity.translate(bounds.width / 2 - node.x * 1.4, bounds.height / 2 - node.y * 1.4).scale(1.4);
      var selection = d3.select(canvas);
      if (reducedMotion) {
        selection.call(zoom.transform, target);
      } else {
        selection.transition().duration(400).call(zoom.transform, target);
      }
    }

    function resetView() {
      searchInput.value = '';
      selectedNode = null;
      hoveredNode = null;
      tooltip.hidden = true;
      drawerPath = [];
      activeCategories = new Set(chipByCategory.keys());
      chipByCategory.forEach(function (chip) {
        chip.classList.remove('is-off');
        chip.setAttribute('aria-pressed', 'true');
      });
      renderDetails(null);
      refresh();
      fitView(true);
    }

    function setupGraph(data) {
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

      var degrees = nodes.map(function (node) { return node.degree; }).sort(function (a, b) { return a - b; });
      hubDegree = Math.max(4, degrees[Math.floor(degrees.length * 0.9)] || 4);

      var counts = new Map();
      nodes.forEach(function (node) {
        counts.set(node.group, (counts.get(node.group) || 0) + 1);
      });

      renderFilters(data.categories, counts);
      resizeCanvas();

      var columns = Math.ceil(Math.sqrt(data.categories.length)) || 1;
      var rows = Math.max(1, Math.ceil(data.categories.length / columns));
      var categoryIndex = new Map(data.categories.map(function (category, index) { return [category, index]; }));
      simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(function (node) { return node.id; }).distance(function (link) { return Math.max(60, 130 - link.weight * 10); }).strength(function (link) { return Math.min(0.8, 0.12 + link.weight * 0.07); }))
        .force('charge', d3.forceManyBody().strength(-140).distanceMax(520))
        .force('collide', d3.forceCollide().radius(function (node) { return nodeRadius(node) + 14; }))
        .force('x', d3.forceX(function (node) { return ((categoryIndex.get(node.group) % columns) + 0.5) * stage.clientWidth / columns; }).strength(0.08))
        .force('y', d3.forceY(function (node) { return (Math.floor(categoryIndex.get(node.group) / columns) + 0.5) * stage.clientHeight / rows; }).strength(0.08))
        .force('center', d3.forceCenter(stage.clientWidth / 2, stage.clientHeight / 2))
        .on('tick', draw)
        .on('end', function () { fitView(true); });

      if (reducedMotion) {
        simulation.stop();
        for (var tick = 0; tick < 220; tick += 1) {
          simulation.tick();
        }
        fitView(false);
        draw();
      }

      zoom = d3.zoom()
        .scaleExtent([0.35, 4])
        .on('zoom', function (event) {
          transform = event.transform;
          draw();
        });
      d3.select(canvas).call(zoom).on('dblclick.zoom', null);

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
        selectedNode = node;
        renderDetails(node);
        draw();
      });
      canvas.addEventListener('dblclick', function () { fitView(true); });

      if (window.__graphResize) {
        window.removeEventListener('resize', window.__graphResize);
      }
      window.__graphResize = function () {
        clearTimeout(window.__graphResizeTimer);
        window.__graphResizeTimer = setTimeout(resizeCanvas, 150);
      };
      window.addEventListener('resize', window.__graphResize);
      resetButton.addEventListener('click', resetView);
      fitButton.addEventListener('click', function () { fitView(true); });
      drawerBack.addEventListener('click', function () {
        if (drawerPath.length) {
          drawerPath.pop();
          renderDrawer('back');
        }
      });
      searchInput.addEventListener('input', refresh);
      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          focusNode(visibleNodes()[0]);
        }
        if (event.key === 'Escape') {
          searchInput.value = '';
          selectedNode = null;
          renderDetails(null);
          refresh();
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
          }
        });
      });

      refresh();
    }

    fetch(root.dataset.graphUrl)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Unable to load graph data');
        }
        return response.json();
      })
      .then(setupGraph)
      .catch(function () {
        status.textContent = '星图数据加载失败，请刷新后重试。';
        emptyState.hidden = false;
        emptyState.textContent = '星图暂时不可用。';
      });
  }

  window.__articleGraphInit = run;
}());
