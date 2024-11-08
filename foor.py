import xml.etree.ElementTree as ET
import matplotlib.pyplot as plt
from matplotlib.path import Path
import matplotlib.patches as patches
import math

def calculate_distance(x1, y1, x2, y2):
    """Calculate the Euclidean distance between two points."""
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

def parse_svg_for_walls(svg_file_path, min_segment_length=10):
    """
    Parses an SVG file and extracts path data likely representing walls based on style attributes, path commands,
    and segment length filtering.

    Args:
        svg_file_path (str): Path to the SVG file.
        min_segment_length (float): Minimum length of line segments to be considered as walls.
    
    Returns:
        list of dict: Extracted path data, including ID, path instructions, and style.
    """
    # Load and parse the SVG file
    try:
        tree = ET.parse(svg_file_path)
        root = tree.getroot()
    except ET.ParseError as e:
        print(f"Error parsing SVG file: {e}")
        return []

    wall_paths = []

    for element in root.iter():
        tag = element.tag.split('}')[-1]  # Remove namespace if present
        if tag == "path":
            path_id = element.attrib.get("id", "N/A")
            d_attr = element.attrib.get("d", "")
            style_attr = element.attrib.get("style", "")

            # Extract stroke-width value, if present, and remove non-numeric characters
            stroke_width = 0
            if 'stroke-width' in style_attr:
                try:
                    stroke_width_str = style_attr.split("stroke-width:")[1].split(";")[0].replace("px", "")
                    stroke_width = float(stroke_width_str)
                except ValueError:
                    pass

            # Check for minimum stroke-width
            if stroke_width > 0.5:
                # Further filter based on segment length
                commands = d_attr.replace(',', ' ').split()
                if len(commands) >= 4:
                    try:
                        x1, y1 = float(commands[1]), float(commands[2])
                        x2, y2 = float(commands[4]), float(commands[5])
                        segment_length = calculate_distance(x1, y1, x2, y2)
                        if segment_length >= min_segment_length:
                            wall_paths.append({
                                "id": path_id,
                                "d": d_attr,
                                "style": style_attr
                            })
                    except (IndexError, ValueError):
                        continue

    print(f"Detected {len(wall_paths)} potential wall paths after filtering by segment length.")
    if wall_paths:
        print(f"Sample path data: {wall_paths[:3]}")  # Show a sample for inspection

    return wall_paths

def parse_d_attribute(d_attr, scale=100):
    """
    Parses the 'd' attribute of an SVG path to extract coordinates for visualization and applies a scaling factor.

    Args:
        d_attr (str): The 'd' attribute of an SVG path.
        scale (float): Scaling factor to adjust coordinate size.
    
    Returns:
        list of tuple: A list of (x, y) tuples representing path points.
    """
    commands = d_attr.replace(',', ' ').split()
    points = []
    current_point = [0, 0]

    i = 0
    while i < len(commands):
        cmd = commands[i]
        if cmd == 'M' or cmd == 'L':  # Move to or line to
            current_point = [float(commands[i + 1]) * scale, float(commands[i + 2]) * scale]
            points.append(tuple(current_point))
            i += 3
        elif cmd == 'H':  # Horizontal line to
            current_point[0] = float(commands[i + 1]) * scale
            points.append(tuple(current_point))
            i += 2
        elif cmd == 'V':  # Vertical line to
            current_point[1] = float(commands[i + 1]) * scale
            points.append(tuple(current_point))
            i += 2
        elif cmd == 'Z':  # Close path
            points.append(points[0])  # Close shape by returning to the starting point
            i += 1
        else:
            i += 1  # Move to the next command if unrecognized (for robustness)

    return points

def visualize_wall_paths(svg_file_path):
    wall_paths = parse_svg_for_walls(svg_file_path)

    fig, ax = plt.subplots()
    ax.set_aspect('equal')
    ax.set_title("Detected Wall Paths from SVG")

    for path_data in wall_paths:
        points = parse_d_attribute(path_data["d"], scale=100)  # Apply scaling for better visibility
        if points:
            path = Path(points)
            patch = patches.PathPatch(path, facecolor='none', edgecolor='blue', lw=1)
            ax.add_patch(patch)

    ax.autoscale()
    plt.gca().invert_yaxis()  # Invert Y-axis to match SVG coordinate system
    plt.show()

svg_file_path = '/Users/fathindosunmu/DEV/MyProjects/junction-2024/public/assets/floor_plans/floor_1_small.svg'
visualize_wall_paths(svg_file_path)