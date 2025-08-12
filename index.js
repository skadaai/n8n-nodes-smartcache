/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) 2025, Victor Duarte
 */

// This file is required as the main entry point for the package
// The actual node implementation is in dist/nodes/SmartCache/SmartCache.node.js after build

module.exports = {
  nodes: [
    {
      name: 'SmartCache',
      type: 'smartCache',
      path: './dist/nodes/SmartCache/SmartCache.node.js',
    },
  ],
}
