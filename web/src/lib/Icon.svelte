<script>
  import kanbanBoard from 'iconoir/icons/regular/kanban-board.svg';
  import viewColumns from 'iconoir/icons/regular/view-columns-3.svg';
  import multiplePages from 'iconoir/icons/regular/multiple-pages.svg';
  import bookmark from 'iconoir/icons/regular/bookmark.svg';
  import settings from 'iconoir/icons/regular/settings.svg';
  import helpCircle from 'iconoir/icons/regular/help-circle.svg';
  import halfMoon from 'iconoir/icons/regular/half-moon.svg';
  import eye from 'iconoir/icons/regular/eye.svg';
  import search from 'iconoir/icons/regular/search.svg';
  import filterList from 'iconoir/icons/regular/filter-list.svg';
  import github from 'iconoir/icons/regular/github.svg';
  import refresh from 'iconoir/icons/regular/refresh.svg';
  import archery from 'iconoir/icons/regular/archery.svg';
  import taskList from 'iconoir/icons/regular/task-list.svg';
  import openBook from 'iconoir/icons/regular/open-book.svg';
  import lock from 'iconoir/icons/regular/lock.svg';
  import navArrowDown from 'iconoir/icons/regular/nav-arrow-down.svg';
  import navArrowRight from 'iconoir/icons/regular/nav-arrow-right.svg';
  import packageIcon from 'iconoir/icons/regular/package.svg';
  import xmark from 'iconoir/icons/regular/xmark.svg';
  import page from 'iconoir/icons/regular/page.svg';
  import link from 'iconoir/icons/regular/link.svg';
  import gitCommit from 'iconoir/icons/regular/git-commit.svg';

  export let name;
  export let size = 18;

  const iconUrls = {
    logo: kanbanBoard,
    board: viewColumns,
    layers: multiplePages,
    bookmark,
    settings,
    help: helpCircle,
    moon: halfMoon,
    eye,
    search,
    filter: filterList,
    github,
    refresh,
    target: archery,
    tasks: taskList,
    book: openBook,
    lock,
    chevron: navArrowDown,
    'chevron-right': navArrowRight,
    inbox: packageIcon,
    close: xmark,
    changes: page,
    link,
    commit: gitCommit,
  };

  $: iconUrl = iconUrls[name] || helpCircle;
  // Vite's SVG data URLs retain apostrophes from SVG attributes. Encode them
  // before placing the official asset URL inside a CSS url() token.
  $: cssIconUrl = iconUrl.replaceAll("'", "%27");
</script>

<span class="icon iconoir" style={`--icon-url: url('${cssIconUrl}'); font-size: ${size}px`} aria-hidden="true"></span>
