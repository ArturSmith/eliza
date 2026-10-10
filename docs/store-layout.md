# Store layout editor

Open **Administration → Store layout** with the `settings.manage` permission.

Set the room width and length in metres. Add equipment from the catalogue, drag it in
the 3D view or floor plan, and use the inspector to change its name, dimensions,
position and orientation. Equipment snaps to a 25 cm grid when dragged. The floor
grid is one metre. Rotate the view or use the zoom slider to inspect the layout.
Undo and redo retain the last 50 edits. **Save layout** stores the plan for the store.

The initial catalogue contains wall and island shelving, wall refrigerators, chest
freezers, checkout counters, produce stands, bakery displays, display stands and
custom equipment. Each object has editable width, depth and height. Rotations are
in 90° increments. Objects must remain within the room and cannot overlap.

## Storage and access

Migration `0051_store_layout.sql` adds one `store_layouts` row per store. The JSON
document contains room dimensions and equipment UUIDs, types, names, coordinates,
dimensions and rotations. `GET /api/store-layout` returns `{layout, version}`;
`POST /api/store-layout` accepts the same shape. Both require `settings.manage`.

The server validates geometry using the shared contracts, serializes writes on the
store row, rejects stale versions with HTTP 409, and records successful changes in
the audit log. Every query is scoped to the authenticated store. Initial empty
plans use version 0; the first saved plan has version 1.

## Rendering and scope

The scene projects procedural 3D equipment geometry into SVG with an isometric
camera. It supports four camera orientations, zoom and a top-down plan. It runs
without WebGL or external model downloads. The coloured packages on shelves are
illustrative; product placement, motion sensors, traffic heatmaps, interior walls
and customer simulations are not yet connected to this editor.
