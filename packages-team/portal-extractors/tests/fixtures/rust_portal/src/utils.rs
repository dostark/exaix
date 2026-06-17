use crate::Point;
use crate::new_point;

/// Double a point's coordinates.
pub fn double_point(p: &Point) -> Point {
    new_point(p.x * 2.0, p.y * 2.0)
}

/// Default origin point.
pub const ORIGIN: Point = Point { x: 0.0, y: 0.0 };
