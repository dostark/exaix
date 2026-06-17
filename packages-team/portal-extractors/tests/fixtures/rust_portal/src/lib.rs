/// A point in 2D space.
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// Available colors.
pub enum Color {
    Red,
    Green,
    Blue,
}

/// Something that can be drawn.
pub trait Drawable {
    fn draw(&self);
}

/// Create a new point.
pub fn new_point(x: f64, y: f64) -> Point {
    Point { x, y }
}

/// Maximum coordinate value.
pub const MAX_COORD: f64 = 1000.0;
