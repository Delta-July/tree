import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import warning from 'warning';
import toArray from 'rc-util/lib/Children/toArray';
import { polyfill } from 'react-lifecycles-compat';

import VirtualList from './VirtualList';

import { treeContextTypes } from './contextTypes';
import TreeNode from './TreeNode';
import {
  convertTreeToEntities, convertDataToTree,
  getPosition, getDragNodesKeys,
  parseCheckedKeys,
  conductExpandParent, calcSelectedKeys,
  calcDropPosition,
  arrAdd, arrDel, posToArr,
  conductCheck,
  warnOnlyTreeNode,
  getVisibleKeyLevelListByTreeNode,
} from './util';

class Tree extends React.Component {
  static propTypes = {
    prefixCls: PropTypes.string,
    style: PropTypes.object,
    className: PropTypes.string,
    tabIndex: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    children: PropTypes.any,
    treeData: PropTypes.array, // Generate treeNode by children
    showLine: PropTypes.bool,
    showIcon: PropTypes.bool,
    icon: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
    focusable: PropTypes.bool,
    selectable: PropTypes.bool,
    disabled: PropTypes.bool,
    multiple: PropTypes.bool,
    checkable: PropTypes.oneOfType([
      PropTypes.bool,
      PropTypes.node,
    ]),
    checkStrictly: PropTypes.bool,
    draggable: PropTypes.bool,
    defaultExpandParent: PropTypes.bool,
    autoExpandParent: PropTypes.bool,
    defaultExpandAll: PropTypes.bool,
    defaultExpandedKeys: PropTypes.arrayOf(PropTypes.string),
    expandedKeys: PropTypes.arrayOf(PropTypes.string),
    defaultCheckedKeys: PropTypes.arrayOf(PropTypes.string),
    checkedKeys: PropTypes.oneOfType([
      PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.number])),
      PropTypes.object,
    ]),
    defaultSelectedKeys: PropTypes.arrayOf(PropTypes.string),
    selectedKeys: PropTypes.arrayOf(PropTypes.string),
    onClick: PropTypes.func,
    onDoubleClick: PropTypes.func,
    onExpand: PropTypes.func,
    onCheck: PropTypes.func,
    onSelect: PropTypes.func,
    onLoad: PropTypes.func,
    loadData: PropTypes.func,
    loadedKeys: PropTypes.arrayOf(PropTypes.string),
    onMouseEnter: PropTypes.func,
    onMouseLeave: PropTypes.func,
    onRightClick: PropTypes.func,
    onDragStart: PropTypes.func,
    onDragEnter: PropTypes.func,
    onDragOver: PropTypes.func,
    onDragLeave: PropTypes.func,
    onDragEnd: PropTypes.func,
    onDrop: PropTypes.func,
    filterTreeNode: PropTypes.func,
    openTransitionName: PropTypes.string,
    openAnimation: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    inlineIndent: PropTypes.number,
    height: PropTypes.number,

    motion: VirtualList.propTypes.motion,
    // Tree will parse treeNode as entities map,
    // This prop enable user to process the Tree with additional entities
    // This function may be remove in future if we start to remove the dependency on key
    // So any user should not relay on this function.
    // If you are refactor this code, you can remove it as your wish
    unstable_processTreeEntity: PropTypes.shape({
      initWrapper: PropTypes.func.isRequired,
      processEntity: PropTypes.func.isRequired,
      onProcessFinished: PropTypes.func.isRequired,
    }),
  };

  static childContextTypes = treeContextTypes;

  static defaultProps = {
    prefixCls: 'rc-tree',
    showLine: false,
    showIcon: true,
    selectable: true,
    multiple: false,
    checkable: false,
    disabled: false,
    checkStrictly: false,
    draggable: false,
    defaultExpandParent: true,
    autoExpandParent: false,
    defaultExpandAll: false,
    defaultExpandedKeys: [],
    defaultCheckedKeys: [],
    defaultSelectedKeys: [],
    inlineIndent: 18,
  };

  state = {
    // TODO: Remove this eslint
    posEntities: {}, // eslint-disable-line react/no-unused-state
    keyEntities: {},

    selectedKeys: [],
    checkedKeys: [],
    halfCheckedKeys: [],
    loadedKeys: [],
    loadingKeys: [],

    treeNode: [], // eslint-disable-line react/no-unused-state

    // We are now use virtual list to show the treeNodes.
    // So we need to collect the visible treeNodes.
    internalVisibleKeyLevels: [],
  };

  getChildContext() {
    const {
      prefixCls, selectable, showIcon, icon, draggable, checkable, checkStrictly, disabled,
      loadData, filterTreeNode,
      openTransitionName, openAnimation,
    } = this.props;

    return {
      rcTree: {
        prefixCls,
        selectable,
        showIcon,
        icon,
        draggable,
        checkable,
        checkStrictly,
        disabled,
        openTransitionName,
        openAnimation,

        loadData,
        filterTreeNode,
        renderTreeNode: this.renderTreeNode,
        isKeyChecked: this.isKeyChecked,

        onNodeClick: this.onNodeClick,
        onNodeDoubleClick: this.onNodeDoubleClick,
        onNodeExpand: this.onNodeExpand,
        onNodeSelect: this.onNodeSelect,
        onNodeCheck: this.onNodeCheck,
        onNodeLoad: this.onNodeLoad,
        onNodeMouseEnter: this.onNodeMouseEnter,
        onNodeMouseLeave: this.onNodeMouseLeave,
        onNodeContextMenu: this.onNodeContextMenu,
        onNodeDragStart: this.onNodeDragStart,
        onNodeDragEnter: this.onNodeDragEnter,
        onNodeDragOver: this.onNodeDragOver,
        onNodeDragLeave: this.onNodeDragLeave,
        onNodeDragEnd: this.onNodeDragEnd,
        onNodeDrop: this.onNodeDrop,
      },
    };
  }

  static getDerivedStateFromProps(props, prevState) {
    const { prevProps } = prevState;
    const newState = {
      prevProps: props,
    };

    function needSync(name) {
      return (!prevProps && name in props) || (prevProps && prevProps[name] !== props[name]);
    }

    // ================== Tree Node ==================
    let treeNode = null;

    // Check if `treeData` or `children` changed and save into the state.
    if (needSync('treeData')) {
      treeNode = convertDataToTree(props.treeData);
    } else if (needSync('children')) {
      treeNode = toArray(props.children);
    }

    // Tree support filter function which will break the tree structure in the vdm.
    // We cache the treeNodes in state so that we can return the treeNode in event trigger.
    if (treeNode) {
      newState.treeNode = treeNode;

      // Calculate the entities data for quick match
      const entitiesMap = convertTreeToEntities(treeNode, props.unstable_processTreeEntity);
      newState.posEntities = entitiesMap.posEntities;
      newState.keyEntities = entitiesMap.keyEntities;
    }

    const keyEntities = newState.keyEntities || prevState.keyEntities;

    // ================ expandedKeys =================
    if (needSync('expandedKeys') || (prevProps && needSync('autoExpandParent'))) {
      newState.expandedKeys = (props.autoExpandParent || (!prevProps && props.defaultExpandParent)) ?
        conductExpandParent(props.expandedKeys, keyEntities) : props.expandedKeys;
    } else if (!prevProps && props.defaultExpandAll) {
      newState.expandedKeys = Object.keys(keyEntities);
    } else if (!prevProps && props.defaultExpandedKeys) {
      newState.expandedKeys = (props.autoExpandParent || props.defaultExpandParent) ?
        conductExpandParent(props.defaultExpandedKeys, keyEntities) : props.defaultExpandedKeys;
    }

    // Generate visible treeNode list
    // TODO: check uncontrolled treeNodes
    if (newState.treeNode || newState.expandedKeys || !prevState.expandedKeys) {
      const internalVisibleKeyLevels = getVisibleKeyLevelListByTreeNode(
        newState.treeNode || prevState.treeNode,
        newState.expandedKeys || prevState.expandedKeys,
        keyEntities,
      );

      newState.internalVisibleKeyLevels = internalVisibleKeyLevels;
    }

    // ================ selectedKeys =================
    if (props.selectable) {
      if (needSync('selectedKeys')) {
        newState.selectedKeys = calcSelectedKeys(props.selectedKeys, props);
      } else if (!prevProps && props.defaultSelectedKeys) {
        newState.selectedKeys = calcSelectedKeys(props.defaultSelectedKeys, props);
      }
    }

    // ================= checkedKeys =================
    if (props.checkable) {
      let checkedKeyEntity;

      if (needSync('checkedKeys')) {
        checkedKeyEntity = parseCheckedKeys(props.checkedKeys) || {};
      } else if (!prevProps && props.defaultCheckedKeys) {
        checkedKeyEntity = parseCheckedKeys(props.defaultCheckedKeys) || {};
      } else if (treeNode) {
        // If treeNode changed, we also need check it
        checkedKeyEntity = {
          checkedKeys: prevState.checkedKeys,
          halfCheckedKeys: prevState.halfCheckedKeys,
        };
      }

      if (checkedKeyEntity) {
        let { checkedKeys = [], halfCheckedKeys = [] } = checkedKeyEntity;

        if (!props.checkStrictly) {
          const conductKeys = conductCheck(checkedKeys, true, keyEntities);
          checkedKeys = conductKeys.checkedKeys;
          halfCheckedKeys = conductKeys.halfCheckedKeys;
        }

        newState.checkedKeys = checkedKeys;
        newState.halfCheckedKeys = halfCheckedKeys;
      }
    }
    // ================= loadedKeys ==================
    if (needSync('loadedKeys')) {
      newState.loadedKeys = props.loadedKeys;
    }

    return newState;
  }

  onNodeDragStart = (event, node) => {
    const { expandedKeys } = this.state;
    const { onDragStart } = this.props;
    const { eventKey, children } = node.props;

    this.dragNode = node;

    this.setState({
      dragNodesKeys: getDragNodesKeys(children, node),
      expandedKeys: arrDel(expandedKeys, eventKey),
    });

    if (onDragStart) {
      onDragStart({ event, node });
    }
  };

  /**
   * [Legacy] Select handler is less small than node,
   * so that this will trigger when drag enter node or select handler.
   * This is a little tricky if customize css without padding.
   * Better for use mouse move event to refresh drag state.
   * But let's just keep it to avoid event trigger logic change.
   */
  onNodeDragEnter = (event, node) => {
    const { expandedKeys } = this.state;
    const { onDragEnter } = this.props;
    const { pos, eventKey } = node.props;

    if (!this.dragNode) return;

    const dropPosition = calcDropPosition(event, node);

    // Skip if drag node is self
    if (
      this.dragNode.props.eventKey === eventKey &&
      dropPosition === 0
    ) {
      this.setState({
        dragOverNodeKey: '',
        dropPosition: null,
      });
      return;
    }

    // Ref: https://github.com/react-component/tree/issues/132
    // Add timeout to let onDragLevel fire before onDragEnter,
    // so that we can clean drag props for onDragLeave node.
    // Macro task for this:
    // https://html.spec.whatwg.org/multipage/webappapis.html#clean-up-after-running-script
    setTimeout(() => {
      // Update drag over node
      this.setState({
        dragOverNodeKey: eventKey,
        dropPosition,
      });

      // Side effect for delay drag
      if (!this.delayedDragEnterLogic) {
        this.delayedDragEnterLogic = {};
      }
      Object.keys(this.delayedDragEnterLogic).forEach((key) => {
        clearTimeout(this.delayedDragEnterLogic[key]);
      });
      this.delayedDragEnterLogic[pos] = setTimeout(() => {
        const newExpandedKeys = arrAdd(expandedKeys, eventKey);
        this.setState({
          expandedKeys: newExpandedKeys,
        });

        if (onDragEnter) {
          onDragEnter({ event, node, expandedKeys: newExpandedKeys });
        }
      }, 400);
    }, 0);
  };
  onNodeDragOver = (event, node) => {
    const { onDragOver } = this.props;
    const { eventKey } = node.props;

    // Update drag position
    if (this.dragNode && eventKey === this.state.dragOverNodeKey) {
      const dropPosition = calcDropPosition(event, node);

      if (dropPosition === this.state.dropPosition) return;

      this.setState({
        dropPosition,
      });
    }

    if (onDragOver) {
      onDragOver({ event, node });
    }
  };
  onNodeDragLeave = (event, node) => {
    const { onDragLeave } = this.props;

    this.setState({
      dragOverNodeKey: '',
    });

    if (onDragLeave) {
      onDragLeave({ event, node });
    }
  };
  onNodeDragEnd = (event, node) => {
    const { onDragEnd } = this.props;
    this.setState({
      dragOverNodeKey: '',
    });
    if (onDragEnd) {
      onDragEnd({ event, node });
    }
  };
  onNodeDrop = (event, node) => {
    const { dragNodesKeys = [], dropPosition } = this.state;
    const { onDrop } = this.props;
    const { eventKey, pos } = node.props;

    this.setState({
      dragOverNodeKey: '',
    });

    if (dragNodesKeys.indexOf(eventKey) !== -1) {
      warning(false, 'Can not drop to dragNode(include it\'s children node)');
      return;
    }

    const posArr = posToArr(pos);

    const dropResult = {
      event,
      node,
      dragNode: this.dragNode,
      dragNodesKeys: dragNodesKeys.slice(),
      dropPosition: dropPosition + Number(posArr[posArr.length - 1]),
    };

    if (dropPosition !== 0) {
      dropResult.dropToGap = true;
    }

    if (onDrop) {
      onDrop(dropResult);
    }
  };

  onNodeClick = (e, treeNode) => {
    const { onClick } = this.props;
    if (onClick) {
      onClick(e, treeNode);
    }
  };

  onNodeDoubleClick = (e, treeNode) => {
    const { onDoubleClick } = this.props;
    if (onDoubleClick) {
      onDoubleClick(e, treeNode);
    }
  };

  onNodeSelect = (e, treeNode) => {
    let { selectedKeys } = this.state;
    const { keyEntities } = this.state;
    const { onSelect, multiple } = this.props;
    const { selected, eventKey } = treeNode.props;
    const targetSelected = !selected;

    // Update selected keys
    if (!targetSelected) {
      selectedKeys = arrDel(selectedKeys, eventKey);
    } else if (!multiple) {
      selectedKeys = [eventKey];
    } else {
      selectedKeys = arrAdd(selectedKeys, eventKey);
    }

    // [Legacy] Not found related usage in doc or upper libs
    const selectedNodes = selectedKeys.map(key => {
      const entity = keyEntities[key];
      if (!entity) return null;

      return entity.node;
    }).filter(node => node);

    this.setUncontrolledState({ selectedKeys });

    if (onSelect) {
      const eventObj = {
        event: 'select',
        selected: targetSelected,
        node: treeNode,
        selectedNodes,
        nativeEvent: e.nativeEvent,
      };
      onSelect(selectedKeys, eventObj);
    }
  };

  onNodeCheck = (e, treeNode, checked) => {
    const { keyEntities, checkedKeys: oriCheckedKeys, halfCheckedKeys: oriHalfCheckedKeys } = this.state;
    const { checkStrictly, onCheck } = this.props;
    const { props: { eventKey } } = treeNode;

    // Prepare trigger arguments
    let checkedObj;
    const eventObj = {
      event: 'check',
      node: treeNode,
      checked,
      nativeEvent: e.nativeEvent,
    };

    if (checkStrictly) {
      const checkedKeys = checked ? arrAdd(oriCheckedKeys, eventKey) : arrDel(oriCheckedKeys, eventKey);
      const halfCheckedKeys = arrDel(oriHalfCheckedKeys, eventKey);
      checkedObj = { checked: checkedKeys, halfChecked: halfCheckedKeys };

      eventObj.checkedNodes = checkedKeys.map(key => keyEntities[key].node);

      this.setUncontrolledState({ checkedKeys });
    } else {
      const { checkedKeys, halfCheckedKeys } = conductCheck([eventKey], checked, keyEntities, {
        checkedKeys: oriCheckedKeys, halfCheckedKeys: oriHalfCheckedKeys,
      });

      checkedObj = checkedKeys;

      // [Legacy] This is used for `rc-tree-select`
      eventObj.checkedNodes = [];
      eventObj.checkedNodesPositions = [];
      eventObj.halfCheckedKeys = halfCheckedKeys;

      checkedKeys.forEach((key) => {
        const entity = keyEntities[key];
        if (!entity) return;

        const { node, pos } = entity;

        eventObj.checkedNodes.push(node);
        eventObj.checkedNodesPositions.push({ node, pos });
      });

      this.setUncontrolledState({
        checkedKeys,
        halfCheckedKeys,
      });
    }

    if (onCheck) {
      onCheck(checkedObj, eventObj);
    }
  };

  onNodeLoad = (treeNode) => {
    const { loadData, onLoad } = this.props;
    const { loadedKeys = [], loadingKeys = [] } = this.state;
    const { eventKey } = treeNode.props;

    if (!loadData || loadedKeys.indexOf(eventKey) !== -1 || loadingKeys.indexOf(eventKey) !== -1) {
      return null;
    }

    this.setState({
      loadingKeys: arrAdd(loadingKeys, eventKey),
    });
    const promise = loadData(treeNode);
    promise.then(() => {
      const newLoadedKeys = arrAdd(this.state.loadedKeys, eventKey);
      this.setUncontrolledState({
        loadedKeys: newLoadedKeys,
      });
      this.setState({
        loadingKeys: arrDel(this.state.loadingKeys, eventKey),
      });

      if (onLoad) {
        const eventObj = {
          event: 'load',
          node: treeNode,
        };
        onLoad(newLoadedKeys, eventObj);
      }
    });

    return promise;
  };

  onNodeExpand = (e, treeNode) => {
    let { expandedKeys } = this.state;
    const { onExpand, loadData } = this.props;
    const { eventKey, expanded } = treeNode.props;

    // Update selected keys
    const index = expandedKeys.indexOf(eventKey);
    const targetExpanded = !expanded;

    warning(
      (expanded && index !== -1) || (!expanded && index === -1),
      'Expand state not sync with index check',
    );

    if (targetExpanded) {
      expandedKeys = arrAdd(expandedKeys, eventKey);
    } else {
      expandedKeys = arrDel(expandedKeys, eventKey);
    }

    this.setUncontrolledExpandedKeys(expandedKeys);

    if (onExpand) {
      onExpand(expandedKeys, {
        node: treeNode,
        expanded: targetExpanded,
        nativeEvent: e.nativeEvent,
      });
    }

    // Async Load data
    if (targetExpanded && loadData) {
      const loadPromise = this.onNodeLoad(treeNode);
      return loadPromise ? loadPromise.then(() => {
        // [Legacy] Refresh logic
        this.setUncontrolledExpandedKeys(expandedKeys);
      }) : null;
    }

    return null;
  };

  onNodeMouseEnter = (event, node) => {
    const { onMouseEnter } = this.props;
    if (onMouseEnter) {
      onMouseEnter({ event, node });
    }
  };

  onNodeMouseLeave = (event, node) => {
    const { onMouseLeave } = this.props;
    if (onMouseLeave) {
      onMouseLeave({ event, node });
    }
  };

  onNodeContextMenu = (event, node) => {
    const { onRightClick } = this.props;
    if (onRightClick) {
      event.preventDefault();
      onRightClick({ event, node });
    }
  };

  /**
   * Only update the value which is not in props
   */
  setUncontrolledState = (state) => {
    let needSync = false;
    const newState = {};

    Object.keys(state).forEach(name => {
      if (name in this.props) return;

      needSync = true;
      newState[name] = state[name];
    });

    if (needSync) {
      this.setState(newState);
    }
  };

  setUncontrolledExpandedKeys = (expandedKeys) => {
    const { treeNode, keyEntities } = this.state;
    if (!('expandedKeys' in this.props)) {
      // We need re-calculate the `internalVisibleKeyLevels`
      const internalVisibleKeyLevels = getVisibleKeyLevelListByTreeNode(
        treeNode,
        expandedKeys,
        keyEntities,
      );

      this.setUncontrolledState({ expandedKeys, internalVisibleKeyLevels });
    }
  };

  isKeyChecked = (key) => {
    const { checkedKeys = [] } = this.state;
    return checkedKeys.indexOf(key) !== -1;
  };

  /**
   * [Legacy] Original logic use `key` as tracking clue.
   * We have to use `cloneElement` to pass `key`.
   */
  renderTreeNode = (child, index, level = 0) => {
    const {
      keyEntities,
      expandedKeys = [], selectedKeys = [], halfCheckedKeys = [],
      loadedKeys = [], loadingKeys = [],
      dragOverNodeKey, dropPosition,
    } = this.state;
    const pos = getPosition(level, index);
    const key = child.key || pos;

    if (!keyEntities[key]) {
      warnOnlyTreeNode();
      return null;
    }

    return React.cloneElement(child, {
      key,
      eventKey: key,
      expanded: expandedKeys.indexOf(key) !== -1,
      selected: selectedKeys.indexOf(key) !== -1,
      loaded: loadedKeys.indexOf(key) !== -1,
      loading: loadingKeys.indexOf(key) !== -1,
      checked: this.isKeyChecked(key),
      halfChecked: halfCheckedKeys.indexOf(key) !== -1,
      pos,

      // [Legacy] Drag props
      dragOver: dragOverNodeKey === key && dropPosition === 0,
      dragOverGapTop: dragOverNodeKey === key && dropPosition === -1,
      dragOverGapBottom: dragOverNodeKey === key && dropPosition === 1,
    });
  };

  renderSingleNode = ({ style, props: { key, level } }) => {
    const {
      keyEntities,
      expandedKeys = [], selectedKeys = [], halfCheckedKeys = [],
      loadedKeys = [], loadingKeys = [],
      dragOverNodeKey, dropPosition,
    } = this.state;
    const { inlineIndent } = this.props;

    const { node, pos } = keyEntities[key];
    const { props: { style: oriStyle, ...props } } = node;

    return React.createElement(TreeNode, {
      ...props,
      style: {
        ...oriStyle,
        paddingLeft: level * inlineIndent,
        ...style,
      },

      // Status props
      key,
      eventKey: key,
      expanded: expandedKeys.indexOf(key) !== -1,
      selected: selectedKeys.indexOf(key) !== -1,
      loaded: loadedKeys.indexOf(key) !== -1,
      loading: loadingKeys.indexOf(key) !== -1,
      checked: this.isKeyChecked(key),
      halfChecked: halfCheckedKeys.indexOf(key) !== -1,
      pos,

      // [Legacy] Drag props
      dragOver: dragOverNodeKey === key && dropPosition === 0,
      dragOverGapTop: dragOverNodeKey === key && dropPosition === -1,
      dragOverGapBottom: dragOverNodeKey === key && dropPosition === 1,
    });
  };

  render() {
    const { internalVisibleKeyLevels } = this.state;
    const {
      prefixCls, className, style, focusable,
      showLine, tabIndex = 0, height,
      motion,
    } = this.props;

    const domProps = {
      style,
      className: classNames(prefixCls, className, {
        [`${prefixCls}-show-line`]: showLine,
      }),
      role: 'tree',
      unselectable: 'on',
    };

    if (focusable) {
      domProps.tabIndex = tabIndex;
      domProps.onKeyDown = this.onKeyDown;
    }

    if (height) {
      // TODO: make `itemMinHeight` as prop
      // Use virtual list
      return (
        <VirtualList
          innerComponent="ul"
          {...domProps}

          dataSource={internalVisibleKeyLevels}
          itemMinHeight={20}
          height={height}
          rowKey="key"
          motion={motion}
        >
          {this.renderSingleNode}
        </VirtualList>
      );
    }

    // Pure render
    return (
      <ul
        {...domProps}
      >
        {internalVisibleKeyLevels.map(({ key, level }) => (
          React.createElement(
            this.renderSingleNode,
            {
              key,
              props: { key, level },
            }
          )
        ))}
      </ul>
    );
  }
}

polyfill(Tree);

export default Tree;
