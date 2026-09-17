(function ($) {
    'use strict';

    var previewLines = 8;

    function isMermaidCodeBlock($code) {
        return /(?:^|\s)(?:language-)?mermaid(?:\s|$)/i.test($code.attr('class') || '');
    }

    function getLineCount($code) {
        var text = $code.text().replace(/\n$/, '');
        return text ? text.split('\n').length : 0;
    }

    function updateButton($button, expanded) {
        var label = expanded ? '收起代码' : '展开代码';
        $button.attr({
            'aria-label': label,
            'aria-expanded': expanded,
            title: label
        });
    }

    function toggleCodeFold($button) {
        var $pre = $button.closest('pre');
        var expanded = $pre.hasClass('code-folded');

        $pre.toggleClass('code-folded', !expanded);
        updateButton($button, expanded);
    }

    function initCodeFolds() {
        $('#post .pjax pre').each(function () {
            var $pre = $(this);
            var $code = $pre.children('code');

            if ($pre.data('codeFoldReady') || !$code.length || isMermaidCodeBlock($code)) {
                return;
            }

            var lineCount = getLineCount($code);
            if (lineCount <= previewLines) {
                $pre.data('codeFoldReady', true);
                return;
            }

            var $toolbar = $pre.children('.code-toolbar');
            if (!$toolbar.length) {
                return;
            }

            var $button = $('<button>', {
                'class': 'code-fold-button',
                type: 'button'
            }).append($('<span>', {
                'class': 'code-fold-icon',
                'aria-hidden': 'true'
            }));

            $button.on('click', function () {
                toggleCodeFold($(this));
            });
            updateButton($button, false);
            $toolbar.find('.code-copy-button').first().before($button);
            $pre
                .addClass('code-folded')
                .attr('data-code-fold-lines', lineCount)
                .data('codeFoldReady', true);
        });
    }

    $(initCodeFolds);
    $(document).on('pjax:end', initCodeFolds);
})(jQuery);